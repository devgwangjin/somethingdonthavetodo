import os
import sys
import time
import json
import base64
import re
import asyncio
import urllib.request
import urllib.error
from pathlib import Path

# ─── 경로 및 설정 ───
BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.json"
PROCESSED_LOG_PATH = BASE_DIR / "processed_files.json"
DOWNLOAD_TEMP_DIR = BASE_DIR / "downloaded_scans"
DOWNLOAD_TEMP_DIR.mkdir(exist_ok=True)

# ─── 전역 상태 ───
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
    """설정 파일 로드"""
    global config
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                config.update(json.load(f))
        except Exception as e:
            print(f"[설정 오류] config.json 읽기 실패: {e}")

def save_config():
    """설정 파일 저장"""
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[설정 오류] config.json 저장 실패: {e}")

def load_processed_files():
    """처리된 파일 목록 로드"""
    global processed_files
    if PROCESSED_LOG_PATH.exists():
        try:
            with open(PROCESSED_LOG_PATH, "r", encoding="utf-8") as f:
                processed_files = set(json.load(f))
        except Exception:
            processed_files = set()

def save_processed_files():
    """처리된 파일 목록 저장"""
    try:
        with open(PROCESSED_LOG_PATH, "w", encoding="utf-8") as f:
            json.dump(list(processed_files), f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[기록 오류] processed_files.json 저장 실패: {e}")

# ─── Gemini AI 파싱 엔진 ───
def parse_with_gemini_api(file_path, api_key):
    """
    Gemini 2.0 Flash 최적화 파싱 엔진
    - 토큰 소진 최소화 (maxOutputTokens 제한)
    - 429 에러 발생 시 구글 지침 시간만큼 정밀 대기 후 1회 안전 재시도
    """
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

        # 다중 명세서 PDF 및 단일 이미지 모두 지원하는 다중 인식 프롬프트
        prompt_text = (
            "이 파일에 1개 이상의 거래명세서 문서/페이지가 들어있을 수 있습니다. "
            "각 거래명세서 문서마다 'date'(YYYY-MM-DD), 'supplier'(상호/공급자명), 'items'(자재 목록: name, qty, price, total, remarks) 필드를 갖는 "
            "JSON 객체들의 배열(Array) 포맷으로 추출해줘. 단 1개뿐이어도 길이 1짜리 배열로 응답해. "
            "응답 예시: [{\"date\": \"2026-07-20\", \"supplier\": \"오포산업\", \"items\": [{\"name\": \"부스바\", \"qty\": 10, \"price\": 5000, \"total\": 50000, \"remarks\": \"\"}]}] "
            "마크다운 없이 오직 JSON 텍스트만 응답해."
        )

        payload = {
            "contents": [
                {
                    "parts": [
                        {"inline_data": {"mime_type": mime_type, "data": base64_data}},
                        {"text": prompt_text}
                    ]
                }
            ],
            "generationConfig": {
                "response_mime_type": "application/json",
                "maxOutputTokens": 1024,
                "temperature": 0.1
            }
        }

        headers = {"Content-Type": "application/json"}
        data_json = json.dumps(payload).encode("utf-8")
        
        # 사용자 계정 쿼터표 분석 기반 최적화 (하루 500회, 분당 15회 넉넉한 쿼터 보유 모델 1순위)
        target_models = [
            "gemini-3.1-flash-lite",
            "gemini-3.5-flash-lite",
            "gemini-2.5-flash-lite",
            "gemini-1.5-flash-latest",
            "gemini-1.5-flash"
        ]
        
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
                                json_match = re.search(r'(\[.*\]|\{.*\})', raw_text, re.DOTALL)
                                clean_json_str = json_match.group(0) if json_match else raw_text
                                parsed_result = json.loads(clean_json_str)
                                print(f"[AI] 🎉 {target_model} 파싱 성공! ({Path(file_path).name})")
                                return parsed_result

                except urllib.error.HTTPError as he:
                    err_body = ""
                    try:
                        err_body = he.read().decode("utf-8", errors="ignore")
                    except Exception:
                        pass

                    if he.code == 429 and attempt == 0:
                        wait_sec = 10
                        match = re.search(r'retryDelay["\']?:\s*["\']?(\d+(\.\d+)?)s', err_body)
                        if match:
                            try:
                                wait_sec = int(float(match.group(1))) + 1
                            except Exception:
                                pass
                        print(f"[AI 429] ⏳ {target_model} 한도 대기 ({wait_sec}초)...")
                        time.sleep(wait_sec)
                        continue
                    else:
                        print(f"[AI] {target_model} HTTP 오류 {he.code}: {he.reason} - {err_body[:100]}")
                        break
                except Exception as ex:
                    print(f"[AI 오류] {target_model} 예외 발생: {ex}")
                    break

    except Exception as ex_all:
        print(f"[AI] 파일 읽기 실패 ({Path(file_path).name}): {ex_all}")

    return None

# ─── 복합기 및 파일 감지 ───
def fetch_scans_from_fujifilm_printer():
    """후지필름 Apeos C3570 복합기 Web Box (192.168.0.210 / 006) 수집"""
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
    """감시 대상 폴더들에서 미처리 신규 PDF/이미지 파일 스캔"""
    targets = [str(DOWNLOAD_TEMP_DIR)]
    
    if config.get("watchFolder") and os.path.exists(config["watchFolder"]):
        targets.append(config["watchFolder"])
        
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
                            # 이미 처리된 파일만 제외하고 최근 7일 이내 파일 모두 감지
                            if file_path not in processed_files and (now - mtime < 86400 * 7):
                                found_files.append((mtime, file_path))
                        except Exception:
                            pass
        except Exception:
            pass

    found_files.sort(key=lambda x: x[0])
    return [f[1] for f in found_files]

# ─── 웹소켓 통신 서버 ───
async def websocket_handler(websocket):
    """웹소켓 비동기 연결 관리 (안정적인 핸드셰이크 유지)"""
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
            except Exception:
                pass
    except Exception:
        pass
    finally:
        connected_websockets.discard(websocket)

async def broadcast_scan_data(scan_data):
    """파싱 결과를 연결된 웹 앱으로 전송"""
    if not connected_websockets:
        return
    message = json.dumps({"type": "SCAN_PARSED", **scan_data}, ensure_ascii=False)
    for ws in list(connected_websockets):
        try:
            await ws.send(message)
        except Exception:
            pass

# ─── 메인 감시 루프 ───
async def scan_loop():
    print("[헬퍼] 스캔 문서 감시 루프 구동 중...")
    while True:
        try:
            # 1. 복합기 박스 자동 수집
            fetch_scans_from_fujifilm_printer()

            # 2. 신규 감지 파일 검색
            new_files = find_new_scan_files()
            for file_path in new_files:
                print(f"[감시] 📄 신규 문서 감지: {Path(file_path).name}")
                
                api_key = config.get("geminiApiKey")
                if not api_key:
                    print(f"[경고] API Key 미등록 상태 ➔ Key 동기화 대기 중... ({Path(file_path).name})")
                    continue

                # API Key가 정식으로 연결되었을 때만 처리완료 기록
                processed_files.add(file_path)
                save_processed_files()

                print(f"[AI] Gemini AI 분석 진행 중... ({Path(file_path).name})")
                result = parse_with_gemini_api(file_path, api_key)
                if result:
                    if isinstance(result, list):
                        for idx, doc_data in enumerate(result):
                            await broadcast_scan_data(doc_data)
                            print(f"[성공] 🚀 웹 앱으로 다중 명세서 ({idx+1}/{len(result)}) 전송 완료!")
                            await asyncio.sleep(1)
                    else:
                        await broadcast_scan_data(result)
                        print(f"[성공] 🚀 웹 앱으로 분석 결과 전송 완료!")
                else:
                    print(f"[알림] 분석 실패 또는 취소됨 ({Path(file_path).name})")

                # 429 방지: 파일 처리 후 안전 쿨다운 5초 대기
                await asyncio.sleep(5)

        except Exception as e:
            print(f"[루프 에러] {e}")

        await asyncio.sleep(config.get("pollIntervalSeconds", 5))

async def main():
    load_config()
    load_processed_files()

    import websockets
    print("=" * 60)
    print("🤖 자재 구매 내역 관리 — 로컬 스캔 헬퍼 서비스 (Ver 2.0 Clean)")
    print(f"📌 복합기 IP: {config.get('printerIp')} (박스: {config.get('printerBoxNum')})")
    print("📌 웹소켓 연동: ws://localhost:8765")
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
