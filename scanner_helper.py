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
def clean_and_repair_json(raw_text):
    """생성 토큰 한도로 인해 끝부분이 약간 잘린 JSON도 안전 복구"""
    if not raw_text:
        return None
    
    json_match = re.search(r'(\[.*\]|\{.*\})', raw_text, re.DOTALL)
    clean_str = json_match.group(0) if json_match else raw_text
    
    # 1. 시도: 정제된 문장 그대로 parse
    try:
        return json.loads(clean_str)
    except Exception:
        pass
        
    # 2. 잘린 괄호 자동 보정 복구
    repaired = clean_str.strip()
    # 닫히지 않은 큰따옴표 보정
    if repaired.count('"') % 2 != 0:
        repaired += '"'
    # 닫히지 않은 객체/배열 보정
    open_brackets = repaired.count('[') - repaired.count(']')
    open_braces = repaired.count('{') - repaired.count('}')
    
    repaired += '}' * max(0, open_braces)
    repaired += ']' * max(0, open_brackets)
    
    try:
        return json.loads(repaired)
    except Exception:
        # 끝에 잘린 불완전 항목 쉼표 제거 후 보정
        repaired_sub = re.sub(r',\s*([}\]])', r'\1', repaired)
        try:
            return json.loads(repaired_sub)
        except Exception:
            return None

def parse_with_gemini_api(file_path, api_key):
    """Gemini API를 사용하여 스캔 파일에서 거래명세서 정보 파싱"""
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
                "maxOutputTokens": 4096,
                "temperature": 0.1
            }
        }

        headers = {"Content-Type": "application/json"}
        data_json = json.dumps(payload).encode("utf-8")
        
        # 정식 구글 API 엔드포인트 지원 모델 라이브러리
        target_models = [
            "gemini-3.1-flash-lite",
            "gemini-3.5-flash-lite",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-flash"
        ]
        
        for target_model in target_models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:generateContent?key={clean_key}"
            
            for attempt in range(2):
                try:
                    req = urllib.request.Request(url, data=data_json, headers=headers, method="POST")
                    with urllib.request.urlopen(req, timeout=35) as resp:
                        res_body = resp.read().decode("utf-8")
                        res_json = json.loads(res_body)

                        candidates = res_json.get("candidates", [])
                        if candidates:
                            parts = candidates[0].get("content", {}).get("parts", [])
                            if parts and "text" in parts[0]:
                                raw_text = parts[0]["text"].strip()
                                parsed_result = clean_and_repair_json(raw_text)
                                if parsed_result:
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

def parse_base64_with_gemini_api(base64_data, mime_type, api_key):
    """웹에서 직접 선택한 PDF/이미지 base64 데이터 파싱"""
    clean_key = api_key.strip()
    if not clean_key:
        return None

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
            "maxOutputTokens": 4096,
            "temperature": 0.1
        }
    }

    headers = {"Content-Type": "application/json"}
    data_json = json.dumps(payload).encode("utf-8")
    
    target_models = [
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash-lite",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-flash"
    ]
    
    for target_model in target_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:generateContent?key={clean_key}"
        try:
            req = urllib.request.Request(url, data=data_json, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=35) as resp:
                res_body = resp.read().decode("utf-8")
                res_json = json.loads(res_body)

                candidates = res_json.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts and "text" in parts[0]:
                        raw_text = parts[0]["text"].strip()
                        parsed_result = clean_and_repair_json(raw_text)
                        if parsed_result:
                            print(f"[AI] 🎉 직접 업로드 파일 ({target_model}) 파싱 성공!")
                            return parsed_result
        except Exception as ex:
            print(f"[AI 오류] {target_model} 파싱 예외: {ex}")
            continue

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
                            # 이미 처리된 파일만 제외하고 미처리 파일 모두 감지
                            if file_path not in processed_files:
                                found_files.append((mtime, file_path))
                        except Exception:
                            pass
        except Exception:
            pass

    found_files.sort(key=lambda x: x[0])
    return [f[1] for f in found_files]

# ─── 웹소켓 통신 서버 ───
async def websocket_handler(websocket):
    """웹소켓 비동기 연결 관리"""
    connected_websockets.add(websocket)
    try:
        # 최초 연결 시 현재 감지된 대기열 파일 목록 전송
        new_files = find_new_scan_files()
        file_list = [{"path": f, "name": Path(f).name} for f in new_files]
        await websocket.send(json.dumps({"type": "SCAN_QUEUE_UPDATED", "files": file_list}, ensure_ascii=False))

        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get("type")
                
                if msg_type == "CONFIG_SYNC":
                    if data.get("apiKey"):
                        config["geminiApiKey"] = data["apiKey"]
                    if data.get("printerIp"):
                        config["printerIp"] = data["printerIp"]
                    if data.get("printerBoxNum"):
                        config["printerBoxNum"] = data["printerBoxNum"]
                    save_config()

                elif msg_type == "PARSE_REQUEST":
                    target_file = data.get("filePath")
                    api_key = config.get("geminiApiKey")
                    if not api_key:
                        print("[경고] 🔴 Gemini API Key가 설정되어 있지 않습니다!")
                        await websocket.send(json.dumps({"type": "PARSE_ERROR", "message": "Gemini API Key가 등록되지 않았습니다. 우측 상단 🤖 AI 스캔 설정에서 API 키를 저장해 주세요."}, ensure_ascii=False))
                        continue

                    if target_file and os.path.exists(target_file):
                        print(f"[AI 분석 요청] 📄 {Path(target_file).name}")
                        processed_files.add(target_file)
                        save_processed_files()

                        result = parse_with_gemini_api(target_file, api_key)
                        if result:
                            if isinstance(result, list):
                                for idx, doc_data in enumerate(result):
                                    await broadcast_scan_data(doc_data)
                                    print(f"[성공] 🚀 다중 명세서 ({idx+1}/{len(result)}) 폼 기입 완료!")
                                    await asyncio.sleep(1)
                            else:
                                await broadcast_scan_data(result)
                                print(f"[성공] 🚀 폼 기입 완료! ({Path(target_file).name})")
                        else:
                            await websocket.send(json.dumps({"type": "PARSE_ERROR", "message": "AI 파싱 분석에 실패했습니다. (Gemini API 응답 없음/오류)"}, ensure_ascii=False))

                        # 대기열 갱신 전송
                        updated_files = find_new_scan_files()
                        up_list = [{"path": f, "name": Path(f).name} for f in updated_files]
                        await broadcast_queue_updated(up_list)
                    else:
                        await websocket.send(json.dumps({"type": "PARSE_ERROR", "message": "요청한 파일이 존재하지 않습니다."}, ensure_ascii=False))

                elif msg_type == "CLEAR_QUEUE":
                    new_files = find_new_scan_files()
                    for f in new_files:
                        processed_files.add(f)
                    save_processed_files()
                    print(f"[대기열 🧹] 스캔 대기 문서 {len(new_files)}건을 모두 지웠습니다.")
                    await broadcast_queue_updated([])

                elif msg_type == "DIRECT_PARSE":
                    base64_data = data.get("base64Data")
                    mime_type = data.get("mimeType", "application/pdf")
                    api_key = config.get("geminiApiKey")

                    if not api_key:
                        print("[경고] 🔴 Gemini API Key가 설정되어 있지 않습니다!")
                        await websocket.send(json.dumps({"type": "PARSE_ERROR", "message": "Gemini API Key가 등록되지 않았습니다. 우측 상단 🤖 AI 스캔 설정에서 API 키를 등록해 주세요."}, ensure_ascii=False))
                        continue

                    if base64_data:
                        print(f"[AI 분석 요청] 📁 수동 업로드 파일 분석 진행 중...")
                        result = parse_base64_with_gemini_api(base64_data, mime_type, api_key)
                        if result:
                            if isinstance(result, list):
                                for idx, doc_data in enumerate(result):
                                    await broadcast_scan_data(doc_data)
                                    print(f"[성공] 🚀 수동 업로드 다중 명세서 ({idx+1}/{len(result)}) 폼 기입 완료!")
                                    await asyncio.sleep(1)
                            else:
                                await broadcast_scan_data(result)
                                print(f"[성공] 🚀 수동 업로드 명세서 폼 기입 완료!")
                        else:
                            await websocket.send(json.dumps({"type": "PARSE_ERROR", "message": "AI가 문서 파싱에 실패했습니다. (API 키 확인 필요)"}, ensure_ascii=False))

            except Exception as e:
                print(f"[소켓 오류] {e}")
    except Exception:
        pass
    finally:
        connected_websockets.discard(websocket)

async def broadcast_queue_updated(file_list):
    """감지된 스캔 목록을 웹 앱으로 브로드캐스트"""
    message = json.dumps({"type": "SCAN_QUEUE_UPDATED", "files": file_list}, ensure_ascii=False)
    for ws in list(connected_websockets):
        try:
            await ws.send(message)
        except Exception:
            pass

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

# ─── 메인 감시 루프 (자동 덮어쓰기 없이 대기열 브로드캐스트만 수행) ───
async def scan_loop():
    print("[헬퍼] 스캔 문서 대기열 감시 루프 구동 중...")
    last_files_count = -1
    while True:
        try:
            fetch_scans_from_fujifilm_printer()
            new_files = find_new_scan_files()
            
            # 대기열 수가 변경되었을 때만 알림 전송 (무단 파싱/덮어쓰기 안 함!)
            if len(new_files) != last_files_count:
                last_files_count = len(new_files)
                file_list = [{"path": f, "name": Path(f).name} for f in new_files]
                await broadcast_queue_updated(file_list)
                if new_files:
                    print(f"[감시] 📄 감지된 대기 문서 {len(new_files)}건 (웹 앱에서 선택 가능)")

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
