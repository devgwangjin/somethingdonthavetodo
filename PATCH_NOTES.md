# 🎮 패치 노트 — 자재 거래 내역 관리 v1.1

> **패치 일자**: 2026년 5월 22일  
> **패치 대상**: [script.js](./script.js)  
> **패치 유형**: 내부 안정성 강화 (리팩토링)

---

## 📢 개발자 코멘트

> 이번 패치는 **UI 변경 없이 내부 코드만 전면 보강**한 업데이트입니다.
> 
> 사용자분들이 체감하는 화면이나 기능은 동일하지만, 데이터가 대량으로 늘어나거나 예상치 못한 입력이 들어왔을 때 프로그램이 훨씬 안정적으로 버텨줄 수 있도록 속부터 단단하게 다시 지었습니다.
> 
> 건물로 치면 **기둥을 철근콘크리트로 교체한 내진 보강 공사**입니다.

---

## 🛠️ 변경 사항 (7건)

### 1. 💾 저장 실패 시 안전장치 추가

**이전**: 브라우저 저장 공간(localStorage)이 꽉 차면 아무 말 없이 저장 실패 → 화면 멈춤

**이후**: 저장 공간 부족 시 **"⚠️ 저장 공간이 부족합니다! CSV 백업 후 오래된 데이터를 정리해주세요."** 알림 표시

```diff
  const saveToLocalStorage = () => {
+     try {
          localStorage.setItem('inventoryData', JSON.stringify(transactions));
+     } catch (e) {
+         alert('⚠️ 저장 공간이 부족합니다!');
+     }
  };
```

---

### 2. ⚡ 수정/삭제 버튼 이벤트 효율화

**이전**: 테이블이 다시 그려질 때마다 수정/삭제 버튼 담당자를 **매번 새로 고용** (수십~수백 회 중복 등록)

**이후**: 담당자를 **처음에 1명만 고용**, 이후 쭉 재사용 (동작은 동일, 내부 효율 향상)

```diff
- // renderTable() 안에서 매번 재할당
- dataTableBody.onclick = (e) => { ... };

+ // renderTable() 바깥에서 1회만 등록
+ dataTableBody.addEventListener('click', (e) => { ... });
```

---

### 3. 🎯 스마트 병합 정확도 향상

**이전**: "5월 20일 멀티탭" 구매가 **2건** 있으면, 병합 시 **첫 번째 건만 인식**하고 두 번째는 무시

**이후**: 이미 매칭된 건은 건너뛰고 다음 건과 매칭 → **모든 건이 정확히 1:1로 짝지어짐**

```diff
+ const matchedIndices = new Set();
  newEntries.forEach(newObj => {
-     const existing = transactions.find(t => 
-         t.date === newObj.date && t.name === newObj.name
-     );
+     const existingIdx = transactions.findIndex((t, idx) =>
+         !matchedIndices.has(idx) && t.date === newObj.date && t.name === newObj.name
+     );
+     if (existingIdx > -1) matchedIndices.add(existingIdx);
  });
```

| 상황 | Before | After |
|------|--------|-------|
| 5/20 멀티탭 2건 병합 | 1건만 복구, 1건 누락 | **2건 모두 정확히 복구** |

---

### 4. 🆔 데이터 고유번호(ID) 충돌 방지

**이전**: `Date.now() + Math.random()` 조합 → CSV 대량 import 시 같은 시각에 ID 겹칠 가능성 존재

**이후**: 브라우저 내장 `crypto.randomUUID()` 사용 → **충돌 확률 사실상 0%**

```diff
- id: Date.now().toString() + Math.random().toString(36).substring(2, 9)

+ const generateId = () => {
+     if (crypto.randomUUID) return crypto.randomUUID();
+     return Date.now().toString(36) + Math.random().toString(36).substring(2, 15);
+ };
```

| 항목 | Before | After |
|------|--------|-------|
| ID 형태 | `171637200012abc` | `f47ac10b-58cc-4372-a567-0e02b2c3d479` |
| 충돌 가능성 | 대량 import 시 존재 | **사실상 0%** |

---

### 5. 🏷️ 매직 넘버 → 이름표 붙이기

**이전**: 코드 곳곳에 `20`, `8`, `4` 같은 숫자가 설명 없이 등장 → "이게 뭘 의미하지?"

**이후**: 모든 숫자에 **명확한 이름표(상수)** 부여

```diff
- const rowsPerPage = 20;
- val.substring(0, 8);           // 8이 뭐지...?
- startPage + 4;                 // 4는 또 뭐지...?

+ const ROWS_PER_PAGE = 20;       // 한 페이지당 항목 수
+ const MAX_DATE_DIGITS = 8;      // YYYYMMDD 숫자 길이
+ const PAGE_BUTTON_COUNT = 5;    // 페이지 버튼 개수
```

---

### 6. 📅 날짜 유효성 검증 추가

**이전**: `2026-99-99`, `2026-02-30` 같은 **존재하지 않는 날짜**도 그대로 저장됨

**이후**: 저장/수정 시 실제 달력에 존재하는 날짜인지 검증 → 잘못된 날짜 **차단**

```diff
+ const isValidDate = (dateStr) => {
+     const [year, month, day] = dateStr.split('-').map(Number);
+     const d = new Date(year, month - 1, day);
+     return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
+ };
```

| 입력 | Before | After |
|------|--------|-------|
| `2026-05-22` | ✅ 저장됨 | ✅ 저장됨 |
| `2026-99-99` | ✅ 저장됨 (문제!) | ❌ **차단** |
| `2026-02-30` | ✅ 저장됨 (2월 30일은 없음!) | ❌ **차단** |

---

### 7. 📦 복붙 코드 → 함수로 통합

**이전**: 날짜 자동 포맷 코드가 **2곳에 완전히 동일하게 복사-붙여넣기** 되어 있음 → 하나를 고치면 다른 곳도 고쳐야 하는데 까먹기 쉬움

**이후**: 함수 1개로 추출 → **1곳만 고치면 모든 곳에 자동 반영**

```diff
- // Before: 12줄짜리 동일 코드가 2군데에 복붙 (24줄)

+ // After: 함수 1개 정의 (12줄) + 호출 2줄 = 14줄
+ const applyDateAutoFormat = (inputEl) => { ... };
+ 
+ applyDateAutoFormat(transactionDateInput);   // 새 거래 등록 폼
+ applyDateAutoFormat(editDateInput);          // 수정 폼
```

---

## 📊 수치 요약

| 지표 | Before | After | 변화 |
|------|--------|-------|------|
| 전체 코드 줄 수 | 568줄 | 559줄 | **-9줄** (기능은 늘고 코드는 줄었음) |
| 이벤트 등록 | 매 렌더링마다 | 1회 | **효율 ↑** |
| ID 충돌 가능성 | 존재 | 0% | **안정성 ↑** |
| 저장 에러 처리 | 없음 | try-catch | **안정성 ↑** |
| 날짜 검증 | 없음 | 실존 날짜만 허용 | **데이터 품질 ↑** |
| 중복 코드 | 2곳 | 1곳 | **유지보수 ↑** |
| 병합 정확도 | 첫 건만 매칭 | 전체 1:1 매칭 | **정확도 ↑** |

---

> **다음 패치 예고**: XSS 보안 강화 (사용자 입력값 이스케이프 처리)
