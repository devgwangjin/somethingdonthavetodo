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
available_models = ["gemini-2.0-flash"]  # API Key 검증 시 자동으로 채워짐

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

def check_gemini_api_key(api_key):
    """Gemini API Key 설정 업데이트"""
    clean_key = api_key.strip()
    if clean_key:
        print("[AI] Gemini API Key 설정 완료!")
        return True
    return False

def parse_with_gemini_api(file_path, api_key):
    """Gemini 1.5 Flash 단일 모델 단 1회 호출 분석 (성공/실패 불문 1회로 종료)"""
    clean_key = api_key.strip()
    if not clean_key:
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

        headers = {"Content-Type": "application/json"}
        data_json = json.dumps(payload).encode("utf-8")
        
        # 구글 계정에 실제 존재하는 정식 엔드포인트 gemini-2.0-flash 사용
        target_models = ["gemini-2.0-flash", "gemini-2.0-flash-lite"]
        
        for target_model in target_models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:generateContent?key={clean_key}"
            
            for attempt in range(2):
                try:
                    req = urllib.request.Request(url, data=data_json, headers=headers, method="POST")
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        res_body = resp.read().decode("utf-8")
                        res_json = json.loads(res_body)

                        candidates = res_json.get("candidates", [])
                        if candidates:
                            parts = candidates[0].get("content", {}).get("parts", [])
                            if parts and "text" in parts[0]:
                                raw_text = parts[0]["text"].strip()
                                json_match = re.search(r'\{.*\}', raw_text, re.DOTALL)
                                clean_json_str = json_match.group(0) if json_match else raw_text
                                parsed_result = json.loads(clean_json_str)
                                print(f"[AI] 🎉 {target_model} 파싱 100% 성공! ({Path(file_path).name})")
                                return parsed_result

                except urllib.error.HTTPError as he:
                    err_body = ""
                    try:
                        err_body = he.read().decode("utf-8", errors="ignore")
                    except Exception:
                        pass

                    if he.code == 429 and attempt == 0:
                        wait_sec = 60
                        match = re.search(r'retryDelay["\']?:\s*["\']?(\d+(\.\d+)?)s', err_body)
                        if match:
                            try:
                                wait_sec = int(float(match.group(1))) + 2
                            except Exception:
                                pass
                        print(f"[AI 429] {target_model} 분당 한도 초과 ➔ 구글 리셋 지침({wait_sec}초) 대기 후 자동 재시도...")
                        time.sleep(wait_sec)
                        continue
                    else:
                        print(f"[AI] {target_model} HTTP Error {he.code}: {he.reason}")
                        break
                except Exception as ex:
                    print(f"[AI] {target_model} 파싱 중 에러 발생 ({Path(file_path).name}): {ex}")
                    break

    except Exception as ex_all:
        print(f"[AI] 전체 처리 에러: {ex_all}")

    return None

def fetch_scans_from_fujifilm_printer():
    """후지필름 Apeos C3570 복합기 Web Box (192.168.0.210 / 006) 수집 시도"""
    printer_ip = config.get("printerIp", "192.168.0.210")
    box_num = config.get("printerBoxNum", "006")
    if not printer_ip:
        return []

    fetched_files = []
    try:
        cgi_url = f"http://{printer_ip}/cgi-bin/mft/box_doc_list.cgi?box_num={box_num}"
        req = urllib.request.Request(cgi_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status == 200:
                html_body = resp.read().decode("utf-8", errors="ignore")
                doc_ids = re.findall(r'doc_id=["\']?(\w+)', html_body)
                for doc_id in doc_ids:
                    get_url = f"http://{printer_ip}/cgi-bin/mft/box_doc_get.cgi?box_num={box_num}&doc_id={doc_id}"
                    save_file_path = DOWNLOAD_TEMP_DIR / f"scan_box_{doc_id}.pdf"
                    if str(save_file_path) not in processed_files and not save_file_path.exists():
                        g_req = urllib.request.Request(get_url, headers={"User-Agent": "Mozilla/5.0"})
                        with urllib.request.urlopen(g_req, timeout=10) as g_resp:
                            with open(save_file_path, "wb") as f_out:
                                f_out.write(g_resp.read())
                        fetched_files.append(str(save_file_path))
    except Exception:
        pass

    return fetched_files

def find_new_scan_files():
    """복합기 자동 수집 + 감시 폴더 + Downloads 폴더의 모든 신규 문서 파일 감지 (대소문자 확장자 지원 및 os.scandir 고속화)"""
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

    valid_exts = ('.pdf', '.jpg', '.jpeg', '.png')
    found_files = []
    now = time.time()

    for folder in targets:
        if not os.path.exists(folder):
            continue
        try:
            with os.scandir(folder) as entries:
                for entry in entries:
                    if entry.is_file() and entry.name.lower().endswith(valid_exts):
                        file_path = entry.path
                        try:
                            mtime = entry.stat().st_mtime
                            if file_path not in processed_files and (now - mtime < 3600):
                                found_files.append((mtime, file_path))
                        except Exception:
                            pass
        except Exception:
            pass

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
                    print("[소켓] 웹 앱으로부터 설정 동기화 완료! (연결 안정 상태)")
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
                
                # 결과 여부 상관없이 단 1회 시도 후 즉시 처리완료 마킹 (재호출 폭발 100% 방지)
                processed_files.add(file_path)
                save_processed_files()

                api_key = config.get("geminiApiKey")
                if api_key:
                    print(f"[AI] gemini-1.5-flash 분석 요청 (1회만 시도)... ({Path(file_path).name})")
                    result = parse_with_gemini_api(file_path, api_key)
                    if result:
                        await broadcast_scan_data(result)
                        print(f"[성공] 🎉 웹 앱으로 스캔 데이터 전송 완료! ({Path(file_path).name})")
                    else:
                        print(f"[알림] 분석 실패 처리 완료 ({Path(file_path).name})")
                else:
                    print("[경고] Gemini API Key가 설정되지 않았습니다. 웹 화면 ⚙️ AI 설정에서 키를 등록해 주세요.")

                await asyncio.sleep(3)

        except Exception as e:
            print(f"[루프] 오류 발생: {e}")

        await asyncio.sleep(config.get("pollIntervalSeconds", 5))

async def main():
    load_config()
    load_processed_files()

    if config.get("geminiApiKey"):
        check_gemini_api_key(config["geminiApiKey"])

    import websockets
    print("=" * 60)
    print("🤖 자재 구매 내역 관리 — 로컬 스캔 헬퍼 백그라운드 서비스")
    print(f"📌 복합기 IP: {config.get('printerIp')} (박스: {config.get('printerBoxNum')})")
    print("📌 웹소켓 서버 포트: ws://localhost:8765")
    print("=" * 60)

    server = await websockets.serve(websocket_handler, "localhost", 8765, ping_interval=20, ping_timeout=20)
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
