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
    """Google Gemini API Key 검증 및 사용 가능한 모델 목록 수집"""
    global available_models
    clean_key = api_key.strip()
    if not clean_key:
        return False
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={clean_key}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            res_body = resp.read().decode("utf-8")
            res_json = json.loads(res_body)
            # 구글 API가 실제 제공하는 모델명만 수집
            all_models = [m["name"].replace("models/", "") for m in res_json.get("models", []) if "generateContent" in m.get("supportedGenerationMethods", [])]
            
            # 무료 한도(15 RPM)가 가장 넉넉한 정식 Flash 모델 우선배치 (2.5 프리뷰는 쿼터가 적어 후순위)
            preferred_order = [
                "gemini-1.5-flash",
                "gemini-1.5-flash-latest",
                "gemini-1.5-flash-8b",
                "gemini-2.0-flash",
                "gemini-2.5-flash",
                "gemini-1.5-pro",
                "gemini-2.0-pro"
            ]
            
            selected = []
            for pref in preferred_order:
                for m in all_models:
                    if pref in m and m not in selected:
                        selected.append(m)
            
            # 남은 모델 추가
            for m in all_models:
                if m not in selected:
                    selected.append(m)
            
            if selected:
                available_models = selected[:6]
                print(f"[AI] API Key 검증 성공! 정식 무료 모델 1순위 적용 ({len(available_models)}개): {available_models}")
                return True
    except urllib.error.HTTPError as he:
        if he.code in [401, 403]:
            print(f"[AI Key 경고] 구글 API Key 인증 실패 (HTTP {he.code}). 키를 다시 확인해 주세요.")
        else:
            print(f"[AI Key 알림] 구글 AI 서버 응답 상태: HTTP {he.code}")
    except Exception as e:
        print(f"[AI Key 경고] API Key 검증 중 오류: {e}")
    
    available_models = ["gemini-2.0-flash", "gemini-1.5-flash-latest"]
    return False

def parse_with_gemini_api(file_path, api_key):
    """Google Gemini 라운드로빈 분석: 429 시 구글 지침 시간만큼 정확히 대기 후 재시도"""
    global available_models
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
        models_to_try = list(available_models)

        for model_name in models_to_try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={clean_key}"
            
            # 모델당 최대 2회 시도 (429 발생 시 대기 후 1회 재시도)
            for attempt in range(2):
                req = urllib.request.Request(url, data=data_json, headers=headers, method="POST")
                try:
                    with urllib.request.urlopen(req, timeout=60) as resp:
                        res_body = resp.read().decode("utf-8")
                        res_json = json.loads(res_body)

                        candidates = res_json.get("candidates", [])
                        if not candidates:
                            print(f"[AI] {model_name} 응답 후보 없음. 건너뜀.")
                            break

                        parts = candidates[0].get("content", {}).get("parts", [])
                        if not parts or "text" not in parts[0]:
                            print(f"[AI] {model_name} 텍스트 파트 없음. 건너뜀.")
                            break

                        raw_text = parts[0]["text"].strip()
                        json_match = re.search(r'\{.*\}', raw_text, re.DOTALL)
                        clean_json_str = json_match.group(0) if json_match else raw_text

                        parsed_result = json.loads(clean_json_str)
                        print(f"[AI] 🎉 {model_name} 모델로 {Path(file_path).name} 파싱 성공! ({len(parsed_result.get('items', []))}건 추출됨)")
                        return parsed_result

                except urllib.error.HTTPError as he:
                    err_body = ""
                    try:
                        err_body = he.read().decode("utf-8", errors="ignore")
                    except Exception:
                        pass

                    if he.code == 429:
                        wait_sec = 8
                        match = re.search(r'retryDelay["\']?:\s*["\']?(\d+(\.\d+)?)s', err_body)
                        if match:
                            try:
                                wait_sec = int(float(match.group(1))) + 2
                            except Exception:
                                pass
                        
                        if attempt == 0:
                            print(f"[AI 429] {model_name} 한도 소진 ➔ 구글 지침대로 {wait_sec}초 대기 후 자동 재시도합니다...")
                            time.sleep(wait_sec)
                            continue  # 같은 모델로 2번째 시도!
                        else:
                            print(f"[AI] {model_name} 재시도 후에도 429 ➔ 다음 모델로 스위칭")
                            break
                    elif he.code in [404, 400]:
                        print(f"[AI] {model_name} 미지원 모델({he.code}) ➔ 목록에서 제거됨")
                        if model_name in available_models and len(available_models) > 1:
                            available_models.remove(model_name)
                        break
                    else:
                        print(f"[AI] API 에러 ({model_name}): HTTP {he.code} {he.reason}")
                        break
                except Exception as ex:
                    print(f"[AI] 파싱 오류 ({model_name}): {ex}")
                    break

        print(f"[AI] 모든 모델 시도 완료. 5분 후 감시 루프에서 자동 재시도합니다. ({Path(file_path).name})")
        return "RATE_LIMITED"

    except Exception as e:
        print(f"[AI] 파일 읽기 오류 ({Path(file_path).name}): {e}")
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
                        check_gemini_api_key(data["apiKey"])
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
    rate_limit_cooldown = 0  # 429 쿨다운 타이머 (초)
    while True:
        try:
            # 쿨다운 중이면 대기
            if rate_limit_cooldown > 0:
                print(f"[대기] API 한도 리셋 대기 중... {rate_limit_cooldown}초 남음")
                await asyncio.sleep(min(rate_limit_cooldown, 30))
                rate_limit_cooldown -= 30
                continue

            new_files = find_new_scan_files()
            for file_path in new_files:
                print(f"[감시] 감지된 새 문서 파일: {Path(file_path).name}")
                api_key = config.get("geminiApiKey")
                if api_key:
                    print(f"[AI] 라운드로빈 분석 시작... ({Path(file_path).name})")
                    result = parse_with_gemini_api(file_path, api_key)
                    if result == "RATE_LIMITED":
                        # 429 전체 실패: 5분(300초) 쿨다운 시작
                        rate_limit_cooldown = 300
                        print(f"[대기] 모든 모델 한도 소진. 5분 후 자동 재시도합니다. (화면은 그대로 두세요!)")
                        break
                    elif result:
                        rate_limit_cooldown = 0  # 성공하면 쿨다운 리셋
                        await broadcast_scan_data(result)
                        processed_files.add(file_path)
                        save_processed_files()
                        print(f"[성공] 웹 앱으로 스캔 데이터 전송 완료! ({Path(file_path).name})")
                    else:
                        print(f"[알림] 분석 실패 처리 ({Path(file_path).name})")
                        processed_files.add(file_path)
                        save_processed_files()
                else:
                    print("[경고] Gemini API Key가 설정되지 않았습니다. 웹 화면 ⚙️ AI 설정에서 키를 등록해 주세요.")

                # 파일 간 5초 딜레이 (속도 제한 방지)
                await asyncio.sleep(5)

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
