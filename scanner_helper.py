import os
import sys
import time
import json
import base64
import glob
import re
import asyncio
import urllib.request
import urllib.error
from pathlib import Path

# 설정 파일 및 기록 파일 경로
CONFIG_PATH = Path(__file__).parent / "config.json"
PROCESSED_LOG_PATH = Path(__file__).parent / "processed_files.json"
DOWNLOAD_TEMP_DIR = Path(__file__).parent / "downloaded_scans"
DOWNLOAD_TEMP_DIR.mkdir(exist_ok=True)

# 전역 상태
config = {
    "printerIp": "192.168.0.210",
    "printerBoxNum": "006",
    "geminiApiKey": "",
    "watchFolder": "",
    "pollIntervalSeconds": 5
}
processed_files = set()
connected_websockets = set()

def load_config():
    global config
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                config.update(json.load(f))
        except Exception as e:
            print(f"[설정] config.json 로드 실패: {e}")

def save_config():
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[설정] config.json 저장 실패: {e}")

def load_processed_files():
    global processed_files
    if PROCESSED_LOG_PATH.exists():
        try:
            with open(PROCESSED_LOG_PATH, "r", encoding="utf-8") as f:
                processed_files = set(json.load(f))
        except Exception as e:
            print(f"[기록] processed_files.json 로드 실패: {e}")

def save_processed_files():
    try:
        with open(PROCESSED_LOG_PATH, "w", encoding="utf-8") as f:
            json.dump(list(processed_files), f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[기록] processed_files.json 저장 실패: {e}")

def parse_with_gemini_api(file_path, api_key):
    """Google Gemini 1.5 Flash REST API를 활용한 명세서 분석"""
    if not api_key:
        print("[AI] Gemini API Key가 설정되지 않았습니다.")
        return None

    file_ext = Path(file_path).suffix.lower()
    mime_type = "application/pdf"
    if file_ext in [".jpg", ".jpeg"]:
        mime_type = "image/jpeg"
    elif file_ext == ".png":
        mime_type = "image/png"

    try:
        with open(file_path, "rb") as f:
            file_bytes = f.read()
            base64_data = base64.b64encode(file_bytes).decode("utf-8")

        prompt_text = (
            "이 거래명세서 이미지/PDF에서 상단 거래일자(YYYY-MM-DD 포맷)와 표 내부의 자재 거래 목록을 추출해줘. "
            "각 자재 항목은 name(품목명), qty(수량-숫자만), price(개당단가-숫자만), total(총액-숫자만), remarks(비고) 필드를 갖는 JSON 구조로 응답해줘. "
            "이하여백, 합계 라인은 제외하고 마크다운 코드블록 없이 오직 JSON 텍스트만 리턴해줘. "
            "응답 예시: {\"date\": \"2026-07-20\", \"items\": [{\"name\": \"명판/300*50\", \"qty\": 40, \"price\": 7000, \"total\": 280000, \"remarks\": \"\"}]}"
        )

        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "inline_data": {
                                "mime_type": mime_type,
                                "data": base64_data
                            }
                        },
                        {
                            "text": prompt_text
                        }
                    ]
                }
            ],
            "generationConfig": {
                "response_mime_type": "application/json"
            }
        }

        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
        headers = {"Content-Type": "application/json"}
        data_json = json.dumps(payload).encode("utf-8")

        req = urllib.request.Request(url, data=data_json, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=30) as resp:
            res_body = resp.read().decode("utf-8")
            res_json = json.loads(res_body)

            raw_text = res_json["candidates"][0]["content"]["parts"][0]["text"].strip()
            if raw_text.startswith("```json"):
                raw_text = raw_text[7:]
            if raw_text.startswith("```"):
                raw_text = raw_text[3:]
            if raw_text.endswith("```"):
                raw_text = raw_text[:-3]

            parsed_result = json.loads(raw_text.strip())
            print(f"[AI] {Path(file_path).name} 파싱 성공: {len(parsed_result.get('items', []))}건 추출됨")
            return parsed_result
    except Exception as e:
        print(f"[AI] Gemini API 분석 실패 ({Path(file_path).name}): {e}")
        return None

def find_new_scan_files():
    """복합기 자동 수집 + 감시 폴더 + Downloads 폴더의 모든 신규 문서 파일 무조건 감지"""
    targets = []
    
    # 1. 복합기 다운로드 폴더
    targets.append(str(DOWNLOAD_TEMP_DIR))

    # 2. 사용자 지정 감시 폴더
    if config.get("watchFolder") and os.path.exists(config["watchFolder"]):
        targets.append(config["watchFolder"])
        
    # 3. 내 기본 Downloads 폴더
    user_downloads = os.path.join(os.path.expanduser("~"), "Downloads")
    if os.path.exists(user_downloads):
        targets.append(user_downloads)

    found_files = []
    for folder in targets:
        for ext in ["*.pdf", "*.jpg", "*.jpeg", "*.png"]:
            for file_path in glob.glob(os.path.join(folder, ext)):
                mtime = os.path.getmtime(file_path)
                # 최근 1시간(3600초) 내 생성/다운로드된 파일 중 미처리건 무조건 감지 (파일명 제한 제거)
                if file_path not in processed_files and (time.time() - mtime < 3600):
                    found_files.append((mtime, file_path))

    found_files.sort(key=lambda x: x[0])
    return [f[1] for f in found_files]

async def websocket_handler(websocket):
    print(f"[소켓] 웹 앱 클라이언트 연결됨: {websocket.remote_address}")
    connected_websockets.add(websocket)
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                if data.get("type") == "CONFIG_SYNC":
                    if data.get("apiKey"):
                        config["geminiApiKey"] = data["apiKey"]
                    if data.get("printerIp"):
                        config["printerIp"] = data["printerIp"]
                    if data.get("printerBoxNum"):
                        config["printerBoxNum"] = data["printerBoxNum"]
                    save_config()
                    print("[소켓] 웹 앱으로부터 설정 동기화 완료!")
            except Exception as e:
                print(f"[소켓] 메시지 처리 오류: {e}")
    except Exception:
        pass
    finally:
        connected_websockets.remove(websocket)
        print("[소켓] 클라이언트 연결 해제됨")

async def broadcast_scan_data(scan_data):
    if not connected_websockets:
        print("[소켓] 연결된 웹 앱이 없어 데이터를 대기시킵니다.")
        return
    message = json.dumps({"type": "SCAN_PARSED", **scan_data}, ensure_ascii=False)
    for ws in list(connected_websockets):
        try:
            await ws.send(message)
        except Exception:
            pass

async def scan_loop():
    print("[헬퍼] 스캔 감시 루프 시작됨...")
    while True:
        try:
            new_files = find_new_scan_files()
            for file_path in new_files:
                print(f"[감시] 감지된 새 문서 파일: {Path(file_path).name}")
                api_key = config.get("geminiApiKey")
                if api_key:
                    print(f"[AI] Gemini AI 분석 진행 중... ({Path(file_path).name})")
                    result = parse_with_gemini_api(file_path, api_key)
                    if result:
                        await broadcast_scan_data(result)
                        processed_files.add(file_path)
                        save_processed_files()
                        print(f"[성공] 웹 앱으로 스캔 데이터 전송 완료! ({Path(file_path).name})")
                    else:
                        # 파싱 실패시 재시도 방지를 위해 기록만 추가
                        processed_files.add(file_path)
                        save_processed_files()
                else:
                    print("[경고] Gemini API Key가 설정되지 않았습니다. 웹 화면 ⚙️ AI 설정에서 키를 등록해 주세요.")

        except Exception as e:
            print(f"[루프] 오류 발생: {e}")

        await asyncio.sleep(config.get("pollIntervalSeconds", 5))

async def main():
    load_config()
    load_processed_files()

    import websockets
    print("=" * 60)
    print("🤖 자재 구매 내역 관리 — 로컬 스캔 헬퍼 백그라운드 서비스")
    print(f"📌 복합기 IP: {config.get('printerIp')} (박스: {config.get('printerBoxNum')})")
    print("📌 웹소켓 서버 포트: ws://localhost:8765")
    print("=" * 60)

    server = await websockets.serve(websocket_handler, "localhost", 8765)
    await asyncio.gather(server.wait_closed(), scan_loop())

if __name__ == "__main__":
    try:
        import websockets
    except ImportError:
        print("[설치] websockets 패키지 설치 중...")
        os.system(f"{sys.executable} -m pip install websockets")
    
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[종료] 헬퍼 서비스를 종료합니다.")
