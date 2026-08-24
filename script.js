document.addEventListener('DOMContentLoaded', () => {
    const itemsContainer = document.getElementById('itemsContainer');
    const addItemBtn = document.getElementById('addItemBtn');
    const itemRowTemplate = document.getElementById('itemRowTemplate');
    const saveTransactionBtn = document.getElementById('saveTransactionBtn');
    const receiptTotalEl = document.getElementById('receiptTotal');
    const dataTableBody = document.getElementById('dataTableBody');
    const sortDateBtn = document.getElementById('sortDateBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const transactionDateInput = document.getElementById('transactionDate');
    const searchInput = document.getElementById('searchInput');

    // ─── 상수 정의 (매직 넘버 제거) ───
    const MAX_DATE_DIGITS = 8;        // YYYYMMDD 숫자 길이
    const PAGE_BUTTON_COUNT = 5;      // 페이지네이션에 표시할 버튼 수
    const ROWS_PER_PAGE = 20;         // 한 페이지당 보여줄 항목 수

    // ─── 유틸리티 함수 ───

    // 날짜 입력 자동 포맷 (YYYYMMDD → YYYY-MM-DD) — 중복 코드 함수로 추출
    const applyDateAutoFormat = (inputEl) => {
        inputEl.addEventListener('input', (e) => {
            let val = e.target.value.replace(/[^0-9]/g, '');
            if (val.length > MAX_DATE_DIGITS) val = val.substring(0, MAX_DATE_DIGITS);
            if (val.length >= 6) {
                val = val.substring(0, 4) + '-' + val.substring(4, 6) + '-' + val.substring(6);
            } else if (val.length >= 4) {
                val = val.substring(0, 4) + '-' + val.substring(4);
            }
            e.target.value = val;
        });
    };

    // 날짜 유효성 검증 (2026-99-99 같은 존재하지 않는 날짜 차단)
    const isValidDate = (dateStr) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
        const [year, month, day] = dateStr.split('-').map(Number);
        const d = new Date(year, month - 1, day);
        return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
    };

    // 고유 ID 생성 (crypto.randomUUID 우선 사용, 미지원 시 폴백)
    const generateId = () => {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 15);
    };

    // 통화 포맷
    const formatCurrency = (num) => {
        return num.toLocaleString('ko-KR');
    };

    // ─── 검색 이벤트 ───
    let searchQuery = '';
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim().toLowerCase();
            currentPage = 1;
            renderTable();
        });
    }

    // ─── 날짜 입력 초기화 ───
    applyDateAutoFormat(transactionDateInput);
    const today = new Date().toISOString().split('T')[0];
    transactionDateInput.value = today;

    // ─── 상태 관리 ───
    let transactions = JSON.parse(localStorage.getItem('inventoryData')) || [];
    let isSortAscending = false;
    let currentPage = 1;
    const paginationContainer = document.getElementById('paginationContainer');

    // ─── 품목명 자동 보정/표준화 사전(Alias Rules) ───
    let itemAliasRules = JSON.parse(localStorage.getItem('itemAliasRules')) || [];

    const saveAliasRules = () => {
        localStorage.setItem('itemAliasRules', JSON.stringify(itemAliasRules));
    };

    // 품목명 변환기 코어 로직 (문자열 포함 검사 후 변환)
    const applyItemAlias = (rawName) => {
        if (!rawName) return rawName;
        const trimName = rawName.trim();
        const lowerName = trimName.toLowerCase();

        for (const rule of itemAliasRules) {
            // 규칙의 keyword가 현재 품목명에 포함되어 있으면 변경
            const keywordLower = rule.keyword.toLowerCase();
            if (lowerName.includes(keywordLower)) {
                // 단, 이미 표준명이 적용된 상태(포함)라면 무시 (중복 적용 방지)
                const stdLower = rule.standardName.toLowerCase();
                if (lowerName.includes(stdLower)) {
                    continue; // 이미 기상 4종이 포함되어 있다면 건너뜀
                }
                return rule.standardName; // 일치하는 규칙 발견 시 첫 번째 매칭 표준명 리턴
            }
        }
        return rawName;
    };

    // ─── 비고 자동 추천: 기존 거래내역에서 동일/유사 품목 매칭 ───
    const findMatchingRemarks = (inputName) => {
        if (!inputName || inputName.trim().length < 2) return null;
        const trimmed = inputName.trim().toLowerCase();

        // 우선순위 1: 정확 일치 (비고가 있는 가장 최근 항목)
        const exactMatch = [...transactions]
            .reverse()
            .find(t => t.name && t.name.trim().toLowerCase() === trimmed && t.remarks && t.remarks.trim());
        if (exactMatch) return { remarks: exactMatch.remarks.trim(), matchType: '정확 일치' };

        // 우선순위 2: 부분 포함 매칭 (3글자 이상 토큰)
        const tokens = trimmed.split(/[\s,\/\-\*\(\)]+/).filter(tk => tk.length >= 3);
        if (tokens.length === 0) return null;

        const partialMatch = [...transactions]
            .reverse()
            .find(t => {
                if (!t.name || !t.remarks || !t.remarks.trim()) return false;
                const tName = t.name.trim().toLowerCase();
                return tokens.some(tk => tName.includes(tk));
            });
        if (partialMatch) return { remarks: partialMatch.remarks.trim(), matchType: '유사 일치' };

        return null;
    };

    // 추천 배너 UI 표시 (옵션 B: 배너만 표시, 사용자 클릭으로 적용)
    const showRemarksSuggestion = (itemRow, suggestion) => {
        // 기존 배너 제거
        const existing = itemRow.querySelector('.remarks-suggestion');
        if (existing) existing.remove();

        const remarksInput = itemRow.querySelector('.item-remarks');
        if (!remarksInput) return;

        // 이미 비고에 내용이 있고, 추천 값과 동일하면 배너 표시하지 않음
        if (remarksInput.value.trim() && remarksInput.value.trim() === suggestion.remarks) return;

        const banner = document.createElement('div');
        banner.className = 'remarks-suggestion';
        banner.innerHTML = `
            <span class="suggestion-text">
                💡 기존 내역 ${suggestion.matchType}: <strong>${suggestion.remarks}</strong>
            </span>
            <div class="suggestion-actions">
                <button type="button" class="apply-btn">✅ 적용</button>
                <button type="button" class="dismiss-btn">✕</button>
            </div>
        `;

        banner.querySelector('.apply-btn').addEventListener('click', () => {
            // 기존 비고에 supplier 태그가 있으면 보존하고 뒤에 추가
            const currentVal = remarksInput.value.trim();
            const supplierMatch = currentVal.match(/^\[.*?\]/);
            if (supplierMatch && !suggestion.remarks.startsWith('[')) {
                remarksInput.value = `${supplierMatch[0]} ${suggestion.remarks}`;
            } else {
                remarksInput.value = suggestion.remarks;
            }
            banner.remove();
        });

        banner.querySelector('.dismiss-btn').addEventListener('click', () => {
            banner.remove();
        });

        itemRow.appendChild(banner);
    };

    // ─── 품목 행 관리 ───
    const addItemRow = () => {
        const clone = itemRowTemplate.content.cloneNode(true);
        const row = clone.querySelector('.item-row');

        const qtyInput = row.querySelector('.item-qty');
        const priceInput = row.querySelector('.item-price');
        const totalInput = row.querySelector('.item-total');
        const deleteBtn = row.querySelector('.btn-delete');
        const nameInput = row.querySelector('.item-name');

        const calculateRowTotal = () => {
            const qty = parseFloat(qtyInput.value) || 0;
            const price = parseFloat(priceInput.value) || 0;
            const total = qty * price;
            totalInput.value = total || '';
            calculateGrandTotal();
        };

        const calculateRowPrice = () => {
            const qty = parseFloat(qtyInput.value) || 0;
            const total = parseFloat(totalInput.value) || 0;
            if (qty > 0) {
                priceInput.value = Math.round(total / qty) || '';
            } else {
                priceInput.value = '';
            }
            calculateGrandTotal();
        };

        qtyInput.addEventListener('input', calculateRowTotal);
        priceInput.addEventListener('input', calculateRowTotal);
        totalInput.addEventListener('input', calculateRowPrice);

        // ─── 품목명 blur 시: 사전 변환 후 비고 추천 ───
        if (nameInput) {
            nameInput.addEventListener('blur', () => {
                let val = nameInput.value.trim();
                
                // 1. 자동 변환 사전 매칭
                if (val.length > 0) {
                    const aliased = applyItemAlias(val);
                    if (aliased !== val) {
                        nameInput.value = aliased;
                        val = aliased;
                        // 변환 안내 시각 효과
                        nameInput.style.backgroundColor = 'rgba(63, 190, 232, 0.1)';
                        setTimeout(() => nameInput.style.backgroundColor = '', 1000);
                    }
                }
                
                // 2. 비고 자동 추천 (기존 로직)
                if (val.length >= 2) {
                    const match = findMatchingRemarks(val);
                    if (match) {
                        showRemarksSuggestion(row, match);
                    }
                }
            });
        }

        deleteBtn.addEventListener('click', () => {
            if (itemsContainer.children.length > 1) {
                row.remove();
                calculateGrandTotal();
            } else {
                alert('최소 1개의 품목은 있어야 합니다.');
            }
        });

        itemsContainer.appendChild(row);
    };

    const calculateGrandTotal = () => {
        let grandTotal = 0;
        const rows = itemsContainer.querySelectorAll('.item-row');
        rows.forEach(row => {
            const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
            const price = parseFloat(row.querySelector('.item-price').value) || 0;
            grandTotal += (qty * price);
        });
        receiptTotalEl.textContent = formatCurrency(grandTotal);
    };

    addItemRow();
    addItemBtn.addEventListener('click', addItemRow);

    // ─── 엑셀 붙여넣기 기능 ───
    const toggleExcelPasteBtn = document.getElementById('toggleExcelPasteBtn');
    const excelPasteArea = document.getElementById('excelPasteArea');
    const excelPasteInput = document.getElementById('excelPasteInput');
    const parseExcelBtn = document.getElementById('parseExcelBtn');
    const cancelExcelBtn = document.getElementById('cancelExcelBtn');

    if (toggleExcelPasteBtn) {
        toggleExcelPasteBtn.addEventListener('click', () => {
            const isVisible = excelPasteArea.style.display !== 'none';
            excelPasteArea.style.display = isVisible ? 'none' : 'block';
            if (!isVisible) {
                excelPasteInput.value = '';
                excelPasteInput.focus();
            }
        });
    }

    if (cancelExcelBtn) {
        cancelExcelBtn.addEventListener('click', () => {
            excelPasteArea.style.display = 'none';
            excelPasteInput.value = '';
        });
    }

    // 엑셀 탭 구분 데이터 → 품목 배열로 파싱
    const parseExcelData = (text) => {
        const lines = text.trim().split('\n').filter(l => l.trim());
        const items = [];

        lines.forEach(line => {
            const cells = line.split('\t').map(c => c.trim());

            // 의미있는 셀만 추출
            const nonEmpty = cells.filter(c => c !== '');
            if (nonEmpty.length < 2) return;

            // 셀을 유형별로 분류
            const numbers = [];  // 숫자 값들 (수량, 단가, 총액)
            const texts = [];    // 텍스트 값들 (품목명, 비고)
            const UNIT_LABELS = ['ea', '개', 'set', '식', 'kg', 'm', 'ea.', 'pcs', 'roll', 'box'];

            cells.forEach((cell, idx) => {
                if (!cell) return;

                // 단위 라벨 건너뛰기
                if (UNIT_LABELS.includes(cell.toLowerCase())) return;

                // 숫자인지 체크 (쉼표 포함 가능: 13,900)
                const cleanNum = cell.replace(/,/g, '');
                if (/^\d+(\.\d+)?$/.test(cleanNum)) {
                    numbers.push({ value: parseFloat(cleanNum), idx, raw: cell });
                } else {
                    texts.push({ value: cell, idx });
                }
            });

            const parsed = { name: '', qty: 0, price: 0, total: 0, remarks: '' };

            // 텍스트 분류: 첫 번째 텍스트 = 품목명, 마지막 텍스트(숫자 뒤) = 비고
            if (texts.length > 0) {
                parsed.name = texts[0].value;

                // 숫자들 중 마지막 숫자의 위치보다 뒤에 있는 텍스트 = 비고
                if (texts.length > 1 && numbers.length > 0) {
                    const lastNumIdx = Math.max(...numbers.map(n => n.idx));
                    const remarkTexts = texts.filter(t => t.idx > lastNumIdx);
                    if (remarkTexts.length > 0) {
                        parsed.remarks = remarkTexts.map(t => t.value).join(' ');
                    }
                }
            }

            // 숫자 분류: 행번호(첫 번째 작은 정수) 건너뛰고, 나머지를 수량/단가/총액 순서로
            let numValues = numbers.map(n => n.value);

            // 첫 번째 숫자가 행번호인지 판단 (품목명보다 앞에 있고, 1~999 사이)
            if (numbers.length > 0 && texts.length > 0 && numbers[0].idx < texts[0].idx && numbers[0].value <= 999 && Number.isInteger(numbers[0].value)) {
                numValues = numValues.slice(1);
            }

            if (numValues.length >= 3) {
                parsed.qty = numValues[0];
                parsed.price = numValues[1];
                parsed.total = numValues[2];
            } else if (numValues.length === 2) {
                parsed.qty = numValues[0];
                parsed.price = numValues[1];
                parsed.total = numValues[0] * numValues[1];
            } else if (numValues.length === 1) {
                parsed.qty = numValues[0];
            }

            if (parsed.name) items.push(parsed);
        });

        return items;
    };

    // 파싱 결과를 폼에 채우기
    if (parseExcelBtn) {
        parseExcelBtn.addEventListener('click', () => {
            const rawText = excelPasteInput.value;
            if (!rawText.trim()) {
                alert('붙여넣기할 데이터가 없습니다.');
                return;
            }

            const items = parseExcelData(rawText);
            if (items.length === 0) {
                alert('인식된 품목이 없습니다. 엑셀에서 데이터 행만 복사해주세요.');
                return;
            }

            // 폼 초기화 후 채우기
            itemsContainer.innerHTML = '';

            items.forEach(item => {
                addItemRow();
                const lastRow = itemsContainer.lastElementChild;
                if (!lastRow) return;

                const nameInput = lastRow.querySelector('.item-name');
                const qtyInput = lastRow.querySelector('.item-qty');
                const priceInput = lastRow.querySelector('.item-price');
                const totalInput = lastRow.querySelector('.item-total');
                const remarksInput = lastRow.querySelector('.item-remarks');

                if (nameInput) {
                    const finalName = applyItemAlias(item.name || '');
                    nameInput.value = finalName;
                    if (finalName !== item.name) {
                        nameInput.style.backgroundColor = 'rgba(63, 190, 232, 0.1)';
                    }
                }
                if (qtyInput) qtyInput.value = item.qty || '';
                if (priceInput) priceInput.value = item.price || '';
                if (totalInput) totalInput.value = item.total || '';
                if (remarksInput) remarksInput.value = item.remarks || '';

                // 비고 자동 추천도 실행
                if (nameInput && nameInput.value) {
                    const match = findMatchingRemarks(nameInput.value);
                    if (match) showRemarksSuggestion(lastRow, match);
                }
            });

            calculateGrandTotal();

            // 닫기
            excelPasteArea.style.display = 'none';
            excelPasteInput.value = '';

            alert(`✅ ${items.length}개 품목이 폼에 입력되었습니다. 확인 후 저장해주세요.`);
        });
    }

    // ─── 저장 (날짜 유효성 검증 추가) ───
    saveTransactionBtn.addEventListener('click', () => {
        const date = transactionDateInput.value;
        if (!date) {
            alert('거래일자를 선택해주세요.');
            return;
        }

        if (!isValidDate(date)) {
            alert('유효하지 않은 날짜입니다. (예: 2026-05-22)');
            return;
        }

        const rows = itemsContainer.querySelectorAll('.item-row');
        let isValid = true;
        let newEntries = [];
        const receiptId = generateId();
        const createdAt = Date.now();

        rows.forEach(row => {
            const name = row.querySelector('.item-name').value.trim();
            const qty = parseFloat(row.querySelector('.item-qty').value);
            const price = parseFloat(row.querySelector('.item-price').value);
            const remarks = row.querySelector('.item-remarks').value.trim();

            if (name || !isNaN(qty) || !isNaN(price)) {
                if (!name || isNaN(qty) || isNaN(price)) {
                    isValid = false;
                } else {
                    newEntries.push({
                        id: generateId(),
                        receiptId: receiptId,
                        createdAt: createdAt,
                        date: date,
                        name: name,
                        qty: qty,
                        price: price,
                        remarks: remarks,
                        total: qty * price
                    });
                }
            }
        });

        if (newEntries.length === 0) {
            alert('최소 1개 이상의 품목을 정확히 입력해주세요.');
            return;
        }

        if (!isValid) {
            alert('모든 항목(품목명, 수량, 단가)을 올바르게 입력해주세요.');
            return;
        }

        // ─── 동일 거래일자 + 동일 품목 중복 검사 ───
        const duplicates = [];
        newEntries.forEach(entry => {
            const isDuplicate = transactions.some(t => 
                t.date === entry.date && 
                t.name.trim().toLowerCase() === entry.name.trim().toLowerCase()
            );
            if (isDuplicate) {
                duplicates.push(`• ${entry.date} [${entry.name}]`);
            }
        });

        if (duplicates.length > 0) {
            const dupMsg = `⚠️ [중복 거래 등록 경고]\n\n다음 품목은 이미 해당 거래일자에 등록되어 있습니다:\n\n${duplicates.join('\n')}\n\n동일 날짜의 중복 항목으로 저장하시겠습니까?`;
            if (!confirm(dupMsg)) {
                return; // 취소 클릭 시 저장 중단
            }
        }

        transactions = [...transactions, ...newEntries];
        saveToLocalStorage();
        renderTable();

        itemsContainer.innerHTML = '';
        addItemRow();
        calculateGrandTotal();

        // 다중 명세서 묶음 진행 중인 경우 자동으로 다음 명세서 폼 기입!
        if (multiDocsQueue.length > 0 && currentMultiDocIndex < multiDocsQueue.length - 1) {
            currentMultiDocIndex++;
            loadCurrentMultiDoc();
        } else if (multiDocsQueue.length > 0 && currentMultiDocIndex >= multiDocsQueue.length - 1) {
            multiDocsQueue = [];
            currentMultiDocIndex = 0;
            if (multiDocBanner) multiDocBanner.style.display = 'none';
            alert('🎉 묶음 문서 내 모든 거래명세서 저장이 성공적으로 완료되었습니다!');
        } else {
            alert('성공적으로 저장되었습니다.');
        }
    });

    // ─── localStorage 저장 (에러 처리 포함) ───
    const saveToLocalStorage = () => {
        try {
            localStorage.setItem('inventoryData', JSON.stringify(transactions));
        } catch (e) {
            alert('⚠️ 저장 공간이 부족합니다! CSV 백업 후 오래된 데이터를 정리해주세요.');
        }
    };

    // ─── 테이블 렌더링 ───
    const renderTable = () => {
        dataTableBody.innerHTML = '';

        // 1. 검색 필터링 (다중 키워드 AND 검색)
        let filteredTransactions = transactions.filter(item => {
            if (!searchQuery) return true;
            const keywords = searchQuery.toLowerCase().split(/[\s,]+/).filter(k => k.trim() !== '');
            const searchableText = (item.date + ' ' + item.name + ' ' + (item.remarks || '') + ' ' + item.price + ' ' + formatCurrency(item.price) + ' ' + item.qty + ' ' + item.total + ' ' + formatCurrency(item.total)).toLowerCase();
            return keywords.every(keyword => searchableText.includes(keyword));
        });

        // 2. 정렬 로직
        let sortedTransactions = [...filteredTransactions];
        sortedTransactions.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            if (dateA.getTime() === dateB.getTime()) {
                const timeA = a.createdAt || 0;
                const timeB = b.createdAt || 0;
                if (timeA === timeB) {
                    return a.id.localeCompare(b.id);
                }
                return isSortAscending ? timeA - timeB : timeB - timeA;
            }
            return isSortAscending ? dateA - dateB : dateB - dateA;
        });

        // 3. 페이지네이션
        const totalPages = Math.ceil(sortedTransactions.length / ROWS_PER_PAGE) || 1;
        if (currentPage > totalPages) currentPage = totalPages;

        const startIndex = (currentPage - 1) * ROWS_PER_PAGE;
        const endIndex = startIndex + ROWS_PER_PAGE;
        const paginatedData = sortedTransactions.slice(startIndex, endIndex);

        // 4. 행 렌더링
        let lastReceiptId = null;
        paginatedData.forEach(item => {
            const currentGroupKey = item.receiptId || item.date;
            const isNewGroup = lastReceiptId !== null && currentGroupKey !== lastReceiptId;
            const showDivider = lastReceiptId !== null && isNewGroup;
            const displayDate = (lastReceiptId === null || isNewGroup) ? item.date : '';

            const tr = document.createElement('tr');
            if (showDivider) {
                tr.classList.add('receipt-divider');
            }
            tr.innerHTML = `
                <td>${displayDate}</td>
                <td>${item.name}</td>
                <td>${item.qty.toLocaleString()}</td>
                <td>${formatCurrency(item.price)}</td>
                <td>${item.remarks || ''}</td>
                <td>${formatCurrency(item.total)}</td>
                <td style="white-space: nowrap;">
                    <button class="edit-row-btn" data-id="${item.id}">✏️ 수정</button>
                    <button class="delete-row-btn" data-id="${item.id}">🗑️ 삭제</button>
                </td>
            `;
            dataTableBody.appendChild(tr);
            lastReceiptId = currentGroupKey;
        });

        renderPagination(totalPages);
    };

    // ─── 페이지네이션 ───
    const renderPagination = (totalPages) => {
        if (!paginationContainer) return;
        paginationContainer.innerHTML = '';

        if (totalPages <= 1) return;

        // 이전 버튼
        if (currentPage > 1) {
            const prevBtn = document.createElement('button');
            prevBtn.className = 'page-btn';
            prevBtn.textContent = '이전';
            prevBtn.onclick = () => { currentPage--; renderTable(); };
            paginationContainer.appendChild(prevBtn);
        }

        // 페이지 번호 (상수 활용)
        let startPage = Math.max(1, currentPage - Math.floor(PAGE_BUTTON_COUNT / 2));
        let endPage = Math.min(totalPages, startPage + PAGE_BUTTON_COUNT - 1);
        if (endPage - startPage < PAGE_BUTTON_COUNT - 1) {
            startPage = Math.max(1, endPage - PAGE_BUTTON_COUNT + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
            const btn = document.createElement('button');
            btn.className = `page-btn ${i === currentPage ? 'active' : ''}`;
            btn.textContent = i;
            btn.onclick = () => { currentPage = i; renderTable(); };
            paginationContainer.appendChild(btn);
        }

        // 다음 버튼
        if (currentPage < totalPages) {
            const nextBtn = document.createElement('button');
            nextBtn.className = 'page-btn';
            nextBtn.textContent = '다음';
            nextBtn.onclick = () => { currentPage++; renderTable(); };
            paginationContainer.appendChild(nextBtn);
        }

        // 페이지 정보 및 직접 이동
        const pageInfoDiv = document.createElement('div');
        pageInfoDiv.className = 'page-info-container';
        pageInfoDiv.innerHTML = `
            <span class="page-text">${currentPage} / ${totalPages} 페이지</span>
            <input type="number" class="page-jump-input" min="1" max="${totalPages}" value="${currentPage}">
            <button class="page-jump-btn page-btn">이동</button>
        `;

        const jumpInput = pageInfoDiv.querySelector('.page-jump-input');
        const jumpBtn = pageInfoDiv.querySelector('.page-jump-btn');

        const jumpToPage = () => {
            let p = parseInt(jumpInput.value);
            if (!isNaN(p)) {
                if (p < 1) p = 1;
                if (p > totalPages) p = totalPages;
                currentPage = p;
                renderTable();
            }
        };

        jumpBtn.addEventListener('click', jumpToPage);
        jumpInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') jumpToPage();
        });

        paginationContainer.appendChild(pageInfoDiv);
    };

    // ─── 수정/삭제 이벤트 위임 (renderTable 외부에서 1회만 등록) ───
    dataTableBody.addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('delete-row-btn')) {
            if (confirm('정말 이 항목을 삭제하시겠습니까?')) {
                const id = target.getAttribute('data-id');
                transactions = transactions.filter(t => t.id !== id);
                saveToLocalStorage();
                renderTable();
            }
        } else if (target.classList.contains('edit-row-btn')) {
            const id = target.getAttribute('data-id');
            const item = transactions.find(t => t.id === id);
            if (!item) return;

            const tr = target.closest('tr');
            tr.innerHTML = `
                <td><input type="text" class="edit-date" value="${item.date}" maxlength="10"></td>
                <td><input type="text" class="edit-name" value="${item.name.replace(/"/g, '&quot;')}"></td>
                <td><input type="number" class="edit-qty" value="${item.qty}" min="1"></td>
                <td><input type="number" class="edit-price" value="${item.price}" min="0"></td>
                <td><input type="text" class="edit-remarks" value="${(item.remarks || '').replace(/"/g, '&quot;')}"></td>
                <td><input type="number" class="edit-total" value="${item.total}" min="0"></td>
                <td style="white-space: nowrap;">
                    <button class="save-edit-btn" data-id="${item.id}">💾 저장</button>
                    <button class="cancel-edit-btn">❌ 취소</button>
                </td>
            `;

            // 추출된 함수로 날짜 자동 포맷 적용
            applyDateAutoFormat(tr.querySelector('.edit-date'));

            // 수정 모드 내 실시간 가격/총액 연동
            const editQtyInput = tr.querySelector('.edit-qty');
            const editPriceInput = tr.querySelector('.edit-price');
            const editTotalInput = tr.querySelector('.edit-total');

            const calculateEditTotal = () => {
                const qty = parseFloat(editQtyInput.value) || 0;
                const price = parseFloat(editPriceInput.value) || 0;
                editTotalInput.value = qty * price || '';
            };

            const calculateEditPrice = () => {
                const qty = parseFloat(editQtyInput.value) || 0;
                const total = parseFloat(editTotalInput.value) || 0;
                if (qty > 0) {
                    editPriceInput.value = Math.round(total / qty) || '';
                } else {
                    editPriceInput.value = '';
                }
            };

            editQtyInput.addEventListener('input', calculateEditTotal);
            editPriceInput.addEventListener('input', calculateEditTotal);
            editTotalInput.addEventListener('input', calculateEditPrice);
        } else if (target.classList.contains('save-edit-btn')) {
            const id = target.getAttribute('data-id');
            const tr = target.closest('tr');
            const newDate = tr.querySelector('.edit-date').value;
            const newName = tr.querySelector('.edit-name').value.trim();
            const newQty = parseFloat(tr.querySelector('.edit-qty').value);
            const newPrice = parseFloat(tr.querySelector('.edit-price').value);
            const newRemarks = tr.querySelector('.edit-remarks').value.trim();

            if (!newDate || !newName || isNaN(newQty) || isNaN(newPrice)) {
                alert('모든 값을 올바르게 입력해주세요.');
                return;
            }

            // 날짜 유효성 검증
            if (!isValidDate(newDate)) {
                alert('유효하지 않은 날짜입니다. (예: 2026-05-22)');
                return;
            }

            const itemIndex = transactions.findIndex(t => t.id === id);
            if (itemIndex > -1) {
                transactions[itemIndex].date = newDate;
                transactions[itemIndex].name = newName;
                transactions[itemIndex].qty = newQty;
                transactions[itemIndex].price = newPrice;
                transactions[itemIndex].remarks = newRemarks;
                transactions[itemIndex].total = newQty * newPrice;
                saveToLocalStorage();
                renderTable();
            }
        } else if (target.classList.contains('cancel-edit-btn')) {
            renderTable();
        }
    });

    // ─── 날짜 정렬 ───
    sortDateBtn.addEventListener('click', () => {
        isSortAscending = !isSortAscending;
        const icon = sortDateBtn.querySelector('.sort-icon');
        icon.textContent = isSortAscending ? '↓' : '↑';
        renderTable();
    });

    // ─── CSV 내보내기 ───
    exportCsvBtn.addEventListener('click', () => {
        if (transactions.length === 0) {
            alert('내보낼 데이터가 없습니다.');
            return;
        }

        let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
        csvContent += "거래일자,품목,수량,개당단가,비고,총액\n";

        let sortedTransactions = [...transactions].sort((a, b) => {
            return isSortAscending ? new Date(a.date) - new Date(b.date) : new Date(b.date) - new Date(a.date);
        });

        sortedTransactions.forEach(row => {
            const safeName = `"${row.name.replace(/"/g, '""')}"`;
            const safeRemarks = `"${(row.remarks || '').replace(/"/g, '""')}"`;
            csvContent += `${row.date},${safeName},${row.qty},${row.price},${safeRemarks},${row.total}\n`;
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `자재구매내역_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // ─── CSV 복원 및 되돌리기 ───
    const importCsvInput = document.getElementById('importCsvInput');
    const importCsvBtn = document.getElementById('importCsvBtn');
    const undoImportBtn = document.getElementById('undoImportBtn');

    const checkBackupExists = () => {
        if (undoImportBtn) {
            if (localStorage.getItem('inventoryData_backup')) {
                undoImportBtn.style.display = 'inline-block';
            } else {
                undoImportBtn.style.display = 'none';
            }
        }
    };
    checkBackupExists();

    if (undoImportBtn) {
        undoImportBtn.addEventListener('click', () => {
            const backup = localStorage.getItem('inventoryData_backup');
            if (!backup) return;

            if (confirm('직전에 복원(병합/덮어쓰기)하기 이전 상태로 데이터를 완전히 되돌리시겠습니까?')) {
                transactions = JSON.parse(backup);
                saveToLocalStorage();
                renderTable();
                localStorage.removeItem('inventoryData_backup');
                checkBackupExists();
                alert('이전 상태로 복구되었습니다.');
            }
        });
    }

    if (importCsvBtn && importCsvInput) {
        importCsvBtn.addEventListener('click', () => {
            importCsvInput.click();
        });

        importCsvInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const csv = event.target.result;
                const lines = csv.split('\n').map(line => line.trim()).filter(line => line);

                if (lines.length < 2) {
                    alert('올바른 파일이 아니거나 복원할 데이터가 없습니다.');
                    return;
                }

                const newEntries = [];
                let currentReceiptId = generateId();
                let lastDateInCsv = null;
                const importTimestamp = Date.now();

                for (let i = 1; i < lines.length; i++) {
                    const row = lines[i];
                    const cols = [];
                    let inQuotes = false;
                    let current = '';
                    for (let c = 0; c < row.length; c++) {
                        const char = row[c];
                        if (char === '"') {
                            inQuotes = !inQuotes;
                        } else if (char === ',' && !inQuotes) {
                            cols.push(current);
                            current = '';
                        } else {
                            current += char;
                        }
                    }
                    cols.push(current);

                    if (cols.length >= 5) {
                        const date = cols[0];
                        const name = cols[1].replace(/^"|"$/g, '').replace(/""/g, '"');
                        const qty = parseFloat(cols[2]);
                        const price = parseFloat(cols[3]);
                        let remarks = '';

                        // 예전 백업 포맷(5개 컬럼)과 새로운 포맷(6개 컬럼) 호환 처리
                        if (cols.length >= 6) {
                            remarks = cols[4].replace(/^"|"$/g, '').replace(/""/g, '"');
                        }

                        if (date && name && !isNaN(qty) && !isNaN(price)) {
                            if (lastDateInCsv !== date) {
                                currentReceiptId = generateId();
                                lastDateInCsv = date;
                            }
                            newEntries.push({
                                id: generateId(),
                                receiptId: currentReceiptId,
                                createdAt: importTimestamp + i,
                                date: date,
                                name: name,
                                qty: qty,
                                price: price,
                                remarks: remarks,
                                total: qty * price
                            });
                        }
                    }
                }

                if (newEntries.length === 0) {
                    alert('복원할 수 있는 유효한 데이터가 없습니다.');
                    return;
                }

                // 가져오기 성공이 확정된 시점에 직전 상태 백업
                localStorage.setItem('inventoryData_backup', JSON.stringify(transactions));
                checkBackupExists();

                const mergeMode = prompt('\u{1F4A1} 스마트 병합 옵션을 선택해주세요.\n\n1: \u{1F4DD} 비고란 복구 (현재 단가/수량 유지 + 백업파일에서 비고란만 가져오기)\n2: \u{1F504} 최신 업데이트 (백업파일 단가/수량으로 변경 + 기존 비고란 유지)\n3: \u2795 단순 이어붙이기 (중복 허용)\n4: \u26A0\uFE0F 완전 덮어쓰기 (기존 데이터 모두 삭제)\n\n원하시는 작업의 번호(1~4)를 입력하세요.', '1');

                if (mergeMode === '1') {
                    // 1: 비고란 복구 — 같은 날짜+품목 중복 항목도 정확히 1:1 매칭
                    const matchedIndices = new Set();
                    newEntries.forEach(newObj => {
                        const existingIdx = transactions.findIndex((t, idx) =>
                            !matchedIndices.has(idx) && t.date === newObj.date && t.name === newObj.name
                        );
                        if (existingIdx > -1) {
                            matchedIndices.add(existingIdx);
                            if (!transactions[existingIdx].remarks && newObj.remarks) {
                                transactions[existingIdx].remarks = newObj.remarks;
                            }
                        } else {
                            transactions.push(newObj);
                        }
                    });
                } else if (mergeMode === '2') {
                    // 2: 최신화 — 같은 날짜+품목 중복 항목도 정확히 1:1 매칭
                    const matchedIndices = new Set();
                    newEntries.forEach(newObj => {
                        const existingIdx = transactions.findIndex((t, idx) =>
                            !matchedIndices.has(idx) && t.date === newObj.date && t.name === newObj.name
                        );
                        if (existingIdx > -1) {
                            matchedIndices.add(existingIdx);
                            transactions[existingIdx].qty = newObj.qty;
                            transactions[existingIdx].price = newObj.price;
                            transactions[existingIdx].total = newObj.total;
                            if (newObj.remarks) {
                                transactions[existingIdx].remarks = newObj.remarks;
                            }
                        } else {
                            transactions.push(newObj);
                        }
                    });
                } else if (mergeMode === '3') {
                    // 3: 단순 이어붙이기
                    transactions = [...transactions, ...newEntries];
                } else if (mergeMode === '4') {
                    // 4: 완전 덮어쓰기
                    transactions = newEntries;
                } else {
                    // 취소
                    localStorage.removeItem('inventoryData_backup');
                    checkBackupExists();
                    alert('복원 작업이 취소되었습니다.');
                    importCsvInput.value = '';
                    return;
                }

                saveToLocalStorage();
                renderTable();
                alert('요청하신 방식으로 데이터 병합이 완료되었습니다! \u{1F389}');
                importCsvInput.value = '';
            };
            reader.readAsText(file, 'utf-8');
        });
    }

    // ─── AI 설정 모달 & 스캔 헬퍼 웹소켓 연동 ───
    const aiSettingsBtn = document.getElementById('aiSettingsBtn');
    const aiSettingsModal = document.getElementById('aiSettingsModal');
    const closeAiModalBtn = document.getElementById('closeAiModalBtn');
    const saveAiSettingsBtn = document.getElementById('saveAiSettingsBtn');
    const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
    const toggleApiKeyVisibilityBtn = document.getElementById('toggleApiKeyVisibilityBtn');
    const printerIpInput = document.getElementById('printerIpInput');
    const printerBoxNumInput = document.getElementById('printerBoxNumInput');
    const helperStatusBadge = document.getElementById('helperStatusBadge');

    // 모달 설정값 불러오기
    const loadAiSettings = () => {
        if (geminiApiKeyInput) geminiApiKeyInput.value = localStorage.getItem('geminiApiKey') || '';
        if (printerIpInput) printerIpInput.value = localStorage.getItem('printerIp') || '192.168.0.210';
        if (printerBoxNumInput) printerBoxNumInput.value = localStorage.getItem('printerBoxNum') || '006';
    };
    loadAiSettings();

    // 배지 상태 업데이트 함수
    const updateHelperBadge = (isOnline) => {
        if (!helperStatusBadge) return;
        if (isOnline) {
            helperStatusBadge.textContent = '🟢 헬퍼 연동됨';
            helperStatusBadge.className = 'status-badge status-on';
        } else {
            helperStatusBadge.textContent = '🔴 헬퍼 미연동';
            helperStatusBadge.className = 'status-badge status-off';
        }
    };

    if (aiSettingsBtn && aiSettingsModal) {
        aiSettingsBtn.addEventListener('click', () => {
            loadAiSettings();
            const isConnected = window._helperSocket && window._helperSocket.readyState === WebSocket.OPEN;
            updateHelperBadge(isConnected);
            aiSettingsModal.style.display = 'flex';
        });

        closeAiModalBtn.addEventListener('click', () => {
            aiSettingsModal.style.display = 'none';
        });

        aiSettingsModal.addEventListener('click', (e) => {
            if (e.target === aiSettingsModal) {
                aiSettingsModal.style.display = 'none';
            }
        });

        toggleApiKeyVisibilityBtn.addEventListener('click', () => {
            if (geminiApiKeyInput.type === 'password') {
                geminiApiKeyInput.type = 'text';
                toggleApiKeyVisibilityBtn.textContent = '숨기기';
            } else {
                geminiApiKeyInput.type = 'password';
                toggleApiKeyVisibilityBtn.textContent = '표시';
            }
        });

        saveAiSettingsBtn.addEventListener('click', () => {
            localStorage.setItem('geminiApiKey', geminiApiKeyInput.value.trim());
            localStorage.setItem('printerIp', printerIpInput.value.trim());
            localStorage.setItem('printerBoxNum', printerBoxNumInput.value.trim());
            alert('🤖 AI 설정이 성공적으로 저장되었습니다!');
            aiSettingsModal.style.display = 'none';
            connectToHelper();
        });
    }

    const scanQueueBanner = document.getElementById('scanQueueBanner');
    const scanFileSelect = document.getElementById('scanFileSelect');
    const triggerAiParseBtn = document.getElementById('triggerAiParseBtn');
    const clearQueueBtn = document.getElementById('clearQueueBtn');
    const scanBannerText = document.getElementById('scanBannerText');
    const triggerDirectUploadBtn = document.getElementById('triggerDirectUploadBtn');
    const directUploadInput = document.getElementById('directUploadInput');

    if (triggerAiParseBtn) {
        triggerAiParseBtn.addEventListener('click', () => {
            if (!scanFileSelect || !scanFileSelect.value) {
                alert('분석할 스캔 문서를 선택해 주세요.');
                return;
            }
            if (!window._helperSocket || window._helperSocket.readyState !== WebSocket.OPEN) {
                alert('🔴 로컬 헬퍼 프로그램이 연결되지 않았습니다. dist/scanner_helper.exe를 실행해 주세요.');
                return;
            }
            triggerAiParseBtn.disabled = true;
            triggerAiParseBtn.textContent = '⏳ AI 분석 진행 중...';
            window._helperSocket.send(JSON.stringify({
                type: 'PARSE_REQUEST',
                filePath: scanFileSelect.value
            }));
        });
    }

    if (clearQueueBtn) {
        clearQueueBtn.addEventListener('click', () => {
            if (!confirm('대기 중인 스캔 문서 목록을 모두 지우시겠습니까?')) return;
            if (window._helperSocket && window._helperSocket.readyState === WebSocket.OPEN) {
                window._helperSocket.send(JSON.stringify({ type: 'CLEAR_QUEUE' }));
            }
            if (scanQueueBanner) scanQueueBanner.style.display = 'none';
        });
    }

    if (triggerDirectUploadBtn && directUploadInput) {
        triggerDirectUploadBtn.addEventListener('click', () => {
            directUploadInput.click();
        });

        directUploadInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!window._helperSocket || window._helperSocket.readyState !== WebSocket.OPEN) {
                alert('🔴 로컬 헬퍼 프로그램이 연결되지 않았습니다. dist/scanner_helper.exe를 실행해 주세요.');
                return;
            }

            const reader = new FileReader();
            triggerDirectUploadBtn.disabled = true;
            triggerDirectUploadBtn.textContent = '⏳ 파일 AI 분석 중...';

            reader.onload = (evt) => {
                const dataUrl = evt.target.result;
                const base64Data = dataUrl.split(',')[1];
                let mimeType = file.type || 'application/pdf';
                if (file.name.endsWith('.pdf')) mimeType = 'application/pdf';
                else if (file.name.endsWith('.png')) mimeType = 'image/png';
                else if (file.name.endsWith('.jpg') || file.name.endsWith('.jpeg')) mimeType = 'image/jpeg';

                window._helperSocket.send(JSON.stringify({
                    type: 'DIRECT_PARSE',
                    base64Data: base64Data,
                    mimeType: mimeType
                }));
            };
            reader.readAsDataURL(file);
            directUploadInput.value = '';
        });
    }

    // 로컬 헬퍼 프로그램 웹소켓 연동 (ws://localhost:8765) 싱글톤 보장
    const connectToHelper = () => {
        if (window._helperSocket) {
            if (window._helperSocket.readyState === WebSocket.OPEN) {
                updateHelperBadge(true);
                const configMsg = {
                    type: 'CONFIG_SYNC',
                    apiKey: localStorage.getItem('geminiApiKey') || '',
                    printerIp: localStorage.getItem('printerIp') || '192.168.0.210',
                    printerBoxNum: localStorage.getItem('printerBoxNum') || '006'
                };
                try { window._helperSocket.send(JSON.stringify(configMsg)); } catch(e){}
                return;
            }
            if (window._helperSocket.readyState === WebSocket.CONNECTING) {
                return;
            }
        }

        try {
            const socket = new WebSocket('ws://localhost:8765');
            window._helperSocket = socket;

            socket.onopen = () => {
                updateHelperBadge(true);
                const configMsg = {
                    type: 'CONFIG_SYNC',
                    apiKey: localStorage.getItem('geminiApiKey') || '',
                    printerIp: localStorage.getItem('printerIp') || '192.168.0.210',
                    printerBoxNum: localStorage.getItem('printerBoxNum') || '006'
                };
                socket.send(JSON.stringify(configMsg));
            };

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'SCAN_QUEUE_UPDATED') {
                        if (Array.isArray(data.files) && data.files.length > 0) {
                            if (scanQueueBanner) scanQueueBanner.style.display = 'block';
                            if (scanBannerText) scanBannerText.textContent = `감지된 문서 ${data.files.length}건이 대기 중입니다.`;
                            if (scanFileSelect) {
                                scanFileSelect.innerHTML = '';
                                data.files.forEach(f => {
                                    const opt = document.createElement('option');
                                    opt.value = f.path;
                                    opt.textContent = f.name;
                                    scanFileSelect.appendChild(opt);
                                });
                            }
                        } else {
                            if (scanQueueBanner) scanQueueBanner.style.display = 'none';
                        }
                    } else if (data.type === 'SCAN_PARSED') {
                        if (triggerAiParseBtn) {
                            triggerAiParseBtn.disabled = false;
                            triggerAiParseBtn.textContent = '🤖 선택 문서 AI 분석 및 폼 기입';
                        }
                        if (triggerDirectUploadBtn) {
                            triggerDirectUploadBtn.disabled = false;
                            triggerDirectUploadBtn.textContent = '📁 PDF/이미지 명세서 선택 (AI 분석)';
                        }
                        if (Array.isArray(data.multiDocs)) {
                            handleMultiDocsReceived(data.multiDocs);
                        } else {
                            handleMultiDocsReceived([data]);
                        }
                    } else if (data.type === 'PARSE_ERROR') {
                        if (triggerAiParseBtn) {
                            triggerAiParseBtn.disabled = false;
                            triggerAiParseBtn.textContent = '🤖 선택 문서 AI 분석 및 폼 기입';
                        }
                        if (triggerDirectUploadBtn) {
                            triggerDirectUploadBtn.disabled = false;
                            triggerDirectUploadBtn.textContent = '📁 PDF/이미지 명세서 선택 (AI 분석)';
                        }
                        alert(`⚠️ AI 분석 오류: ${data.message || '다시 시도해 주세요.'}`);
                    }
                } catch (e) {
                    console.error('웹소켓 데이터 파싱 에러:', e);
                }
            };

            socket.onclose = (e) => {
                updateHelperBadge(false);
                window._helperSocket = null;
                setTimeout(connectToHelper, 3000);
            };

            socket.onerror = () => {
                updateHelperBadge(false);
            };
        } catch (err) {
            updateHelperBadge(false);
        }
    };

    // ─── 다중 명세서 묶음 순차 기입 컨트롤러 ───
    let multiDocsQueue = [];
    let currentMultiDocIndex = 0;

    const multiDocBanner = document.getElementById('multiDocBanner');
    const multiDocStatusText = document.getElementById('multiDocStatusText');
    const nextMultiDocBtn = document.getElementById('nextMultiDocBtn');
    const cancelMultiDocBtn = document.getElementById('cancelMultiDocBtn');

    const loadCurrentMultiDoc = () => {
        if (currentMultiDocIndex < multiDocsQueue.length) {
            const doc = multiDocsQueue[currentMultiDocIndex];
            if (multiDocBanner) multiDocBanner.style.display = 'block';
            if (multiDocStatusText) {
                const supplierStr = doc.supplier ? `[${doc.supplier}] ` : '';
                multiDocStatusText.textContent = `총 ${multiDocsQueue.length}건 중 ${currentMultiDocIndex + 1}번째 ${supplierStr}명세서 기입됨 ([저장하기] 누르면 다음 명세서로 자동 전환)`;
            }
            fillFormWithSingleDoc(doc);
        } else {
            if (multiDocBanner) multiDocBanner.style.display = 'none';
            multiDocsQueue = [];
            currentMultiDocIndex = 0;
            alert('🎉 모든 거래명세서 작성이 성공적으로 완료되었습니다!');
        }
    };

    if (nextMultiDocBtn) {
        nextMultiDocBtn.addEventListener('click', () => {
            currentMultiDocIndex++;
            loadCurrentMultiDoc();
        });
    }

    if (cancelMultiDocBtn) {
        cancelMultiDocBtn.addEventListener('click', () => {
            if (confirm('다중 명세서 순차 기입을 종료하시겠습니까?')) {
                multiDocsQueue = [];
                currentMultiDocIndex = 0;
                if (multiDocBanner) multiDocBanner.style.display = 'none';
            }
        });
    }

    // AI가 분석한 스캔 데이터 1건을 폼에 기입하는 전용 함수
    const fillFormWithSingleDoc = (scanData) => {
        if (scanData.date) {
            let cleanDate = scanData.date.replace(/[\.\/]/g, '-').trim();
            if (/^\d{8}$/.test(cleanDate)) {
                cleanDate = cleanDate.substring(0, 4) + '-' + cleanDate.substring(4, 6) + '-' + cleanDate.substring(6);
            }
            if (isValidDate(cleanDate)) {
                transactionDateInput.value = cleanDate;
            }
        }

        if (Array.isArray(scanData.items) && scanData.items.length > 0) {
            itemsContainer.innerHTML = '';

            const supplierTag = (scanData.supplier && scanData.supplier.trim()) ? `[${scanData.supplier.trim()}]` : '';

            scanData.items.forEach(item => {
                addItemRow();
                const lastRow = itemsContainer.lastElementChild;
                if (!lastRow) return;

                const nameInput = lastRow.querySelector('.item-name');
                const qtyInput = lastRow.querySelector('.item-qty');
                const priceInput = lastRow.querySelector('.item-price');
                const totalInput = lastRow.querySelector('.item-total');
                const remarksInput = lastRow.querySelector('.item-remarks');

                if (nameInput) {
                    const finalName = applyItemAlias(item.name || '');
                    nameInput.value = finalName;
                    if (finalName !== (item.name || '')) {
                        nameInput.style.backgroundColor = 'rgba(63, 190, 232, 0.1)';
                    }
                }
                
                if (qtyInput) qtyInput.value = item.qty || '';
                if (priceInput) priceInput.value = item.price || '';
                if (totalInput) totalInput.value = item.total || (item.qty && item.price ? item.qty * item.price : '');
                
                if (remarksInput) {
                    let rawRemarks = (item.remarks || '').trim();
                    if (supplierTag) {
                        if (rawRemarks) {
                            if (!rawRemarks.includes(supplierTag)) {
                                remarksInput.value = `${supplierTag} ${rawRemarks}`;
                            } else {
                                remarksInput.value = rawRemarks;
                            }
                        } else {
                            remarksInput.value = supplierTag;
                        }
                    } else {
                        remarksInput.value = rawRemarks;
                    }
                }

                // ─── AI 파싱 후 비고 자동 추천 (옵션 B: 배너만 표시) ───
                if (nameInput && nameInput.value) {
                    const match = findMatchingRemarks(nameInput.value);
                    if (match) {
                        showRemarksSuggestion(lastRow, match);
                    }
                }
            });

            calculateGrandTotal();

            // ─── AI 기입 직후 중복 품목 존재 여부 실시간 안내 ───
            const targetDate = transactionDateInput.value;
            const currentDupes = [];
            scanData.items.forEach(item => {
                if (item.name) {
                    const exists = transactions.some(t => 
                        t.date === targetDate && 
                        t.name.trim().toLowerCase() === item.name.trim().toLowerCase()
                    );
                    if (exists) {
                        currentDupes.push(item.name);
                    }
                }
            });

            if (currentDupes.length > 0) {
                setTimeout(() => {
                    alert(`⚠️ [중복 알림]\n\n입력된 명세서의 다음 품목은 이미 ${targetDate} 일자에 등록된 기록이 있습니다:\n- ${currentDupes.join(', ')}\n\n내용을 확인하신 후 저장 여부를 결정해 주세요.`);
                }, 200);
            }
        }
    };

    // 소켓 수신 핸들러 내부에서 multiDocs 처리
    const handleMultiDocsReceived = (docs) => {
        if (!Array.isArray(docs) || docs.length === 0) return;
        multiDocsQueue = docs;
        currentMultiDocIndex = 0;
        loadCurrentMultiDoc();
    };

    // ─── 품목 통일 관리 ───
    const unifyModal = document.getElementById('unifyModal');
    const unifyItemList = document.getElementById('unifyItemList');
    const unifySearchInput = document.getElementById('unifySearchInput');
    const unifyTargetName = document.getElementById('unifyTargetName');
    const unifyStats = document.getElementById('unifyStats');
    const applyUnifyBtn = document.getElementById('applyUnifyBtn');
    const unifyItemsBtn = document.getElementById('unifyItemsBtn');
    const closeUnifyModalBtn = document.getElementById('closeUnifyModalBtn');

    // 고유 품목명 + 건수 추출 (유사 이름끼리 자동 정렬)
    const getUniqueItems = () => {
        const countMap = {};
        transactions.forEach(t => {
            if (t.name && t.name.trim()) {
                const name = t.name.trim();
                countMap[name] = (countMap[name] || 0) + 1;
            }
        });
        // 이름순 정렬 → 비슷한 이름끼리 모임
        return Object.entries(countMap)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    };

    // 품목 리스트 렌더링
    const renderUnifyList = (filterText = '') => {
        const items = getUniqueItems();
        const filter = filterText.trim().toLowerCase();
        const filtered = filter
            ? items.filter(i => i.name.toLowerCase().includes(filter))
            : items;

        unifyItemList.innerHTML = '';
        unifyStats.textContent = `총 ${items.length}개 품목 / 표시 ${filtered.length}개`;

        filtered.forEach(item => {
            const row = document.createElement('div');
            row.className = 'unify-item';
            row.innerHTML = `
                <input type="checkbox" data-name="${item.name.replace(/"/g, '&quot;')}">
                <span class="item-label">${item.name}</span>
                <span class="item-count">${item.count}건</span>
                <button type="button" class="use-as-standard-btn">이것으로 통일</button>
            `;

            const checkbox = row.querySelector('input[type="checkbox"]');
            const useBtn = row.querySelector('.use-as-standard-btn');

            // 행 클릭 → 체크박스 토글
            row.addEventListener('click', (e) => {
                if (e.target === useBtn || e.target === checkbox) return;
                checkbox.checked = !checkbox.checked;
                row.classList.toggle('selected', checkbox.checked);
            });

            checkbox.addEventListener('change', () => {
                row.classList.toggle('selected', checkbox.checked);
            });

            // "이것으로 통일" 버튼 → 표준명 입력란에 이 품목명 채우기
            useBtn.addEventListener('click', () => {
                unifyTargetName.value = item.name;
                unifyTargetName.focus();
            });

            unifyItemList.appendChild(row);
        });
        });
    };

    // ─── 기존 수동 통일(탭 1) 기능 유지 ───
    if (unifyItemsBtn) {
        unifyItemsBtn.addEventListener('click', () => {
            unifyModal.style.display = 'flex';
            unifySearchInput.value = '';
            unifyTargetName.value = '';
            renderUnifyList();
            
            // 모달 열 때 기본으로 첫 번째 탭 활성화
            if (tabBtns[0]) tabBtns[0].click();
        });
    }

    if (closeUnifyModalBtn) {
        closeUnifyModalBtn.addEventListener('click', () => {
            unifyModal.style.display = 'none';
        });
    }
    if (unifyModal) {
        unifyModal.addEventListener('click', (e) => {
            if (e.target === unifyModal) unifyModal.style.display = 'none';
        });
    }

    if (unifySearchInput) {
        unifySearchInput.addEventListener('input', (e) => {
            renderUnifyList(e.target.value);
        });
    }

    if (applyUnifyBtn) {
        applyUnifyBtn.addEventListener('click', () => {
            const targetName = unifyTargetName.value.trim();
            if (!targetName) {
                alert('통일할 품목명을 입력해주세요.');
                return;
            }

            const checkedBoxes = unifyItemList.querySelectorAll('input[type="checkbox"]:checked');
            if (checkedBoxes.length === 0) {
                alert('변환할 품목을 선택해주세요.');
                return;
            }

            const selectedNames = Array.from(checkedBoxes).map(cb => cb.dataset.name);

            if (selectedNames.length === 1 && selectedNames[0] === targetName) {
                alert('선택한 품목과 통일할 이름이 동일합니다.');
                return;
            }

            const confirmMsg = `다음 ${selectedNames.length}개 품목명을 "${targetName}"(으)로 통일합니다.\n\n${selectedNames.map(n => `• ${n}`).join('\n')}\n\n진행하시겠습니까?`;
            if (!confirm(confirmMsg)) return;

            localStorage.setItem('inventoryData_backup', JSON.stringify(transactions));

            let changeCount = 0;
            transactions.forEach(t => {
                if (t.name && selectedNames.includes(t.name.trim())) {
                    t.name = targetName;
                    changeCount++;
                }
            });

            saveToLocalStorage();
            renderTable();

            alert(`✅ 완료! ${changeCount}건의 거래 내역이 "${targetName}"(으)로 통일되었습니다.`);
            
            unifyTargetName.value = '';
            renderUnifyList(unifySearchInput.value);
        });
    }

    // ─── 탭 전환 로직 ───
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => {
                b.classList.remove('active');
                b.style.borderBottomColor = 'transparent';
                b.style.color = '#8b949e';
            });
            tabContents.forEach(c => c.style.display = 'none');

            btn.classList.add('active');
            btn.style.borderBottomColor = '#f0b429';
            btn.style.color = '#f0b429';

            const targetId = btn.dataset.tab;
            document.getElementById(targetId).style.display = 'flex';
            
            if (targetId === 'tab-alias') {
                renderAliasRules();
            }
        });
    });

    // ─── 자동 변환 사전(Alias) 관리 및 검수 미리보기 로직 ───
    const aliasRuleList = document.getElementById('aliasRuleList');
    const addAliasRuleBtn = document.getElementById('addAliasRuleBtn');
    const aliasKeywordInput = document.getElementById('aliasKeyword');
    const aliasStandardInput = document.getElementById('aliasStandard');
    
    const aliasPreviewTable = document.getElementById('aliasPreviewTable');
    const aliasPreviewBody = document.getElementById('aliasPreviewBody');
    const previewEmptyState = document.getElementById('previewEmptyState');
    const previewAliasChangesBtn = document.getElementById('previewAliasChangesBtn');
    const applyPreviewActionDiv = document.getElementById('applyPreviewActionDiv');
    const applyPreviewChangesBtn = document.getElementById('applyPreviewChangesBtn');
    const selectAllPreview = document.getElementById('selectAllPreview');
    const previewSelectedCount = document.getElementById('previewSelectedCount');

    let currentPreviewItems = [];

    // 규칙 목록 렌더링
    const renderAliasRules = () => {
        aliasRuleList.innerHTML = '';
        if (itemAliasRules.length === 0) {
            aliasRuleList.innerHTML = '<div style="color: #6b7280; text-align: center; font-size: 12px; margin-top: 20px;">등록된 규칙이 없습니다.</div>';
            return;
        }

        itemAliasRules.forEach((rule, index) => {
            const div = document.createElement('div');
            div.className = 'alias-rule-item';
            div.innerHTML = `
                <span class="keyword">${rule.keyword}</span>
                <span class="arrow">➔</span>
                <span class="standard">${rule.standardName}</span>
                <button type="button" class="delete-btn" data-idx="${index}">삭제</button>
            `;
            div.querySelector('.delete-btn').addEventListener('click', () => {
                if (confirm(`'${rule.keyword}' 규칙을 삭제하시겠습니까?`)) {
                    itemAliasRules.splice(index, 1);
                    saveAliasRules();
                    renderAliasRules();
                }
            });
            aliasRuleList.appendChild(div);
        });
    };

    // 규칙 추가
    if (addAliasRuleBtn) {
        addAliasRuleBtn.addEventListener('click', () => {
            const keyword = aliasKeywordInput.value.trim();
            const standardName = aliasStandardInput.value.trim();

            if (!keyword || !standardName) {
                alert('원래 입력명과 표준 품목명을 모두 입력해주세요.');
                return;
            }

            // 중복 검사
            const exists = itemAliasRules.some(r => r.keyword.toLowerCase() === keyword.toLowerCase());
            if (exists) {
                alert('이미 등록된 키워드입니다.');
                return;
            }

            itemAliasRules.push({ keyword, standardName });
            saveAliasRules();
            
            aliasKeywordInput.value = '';
            aliasStandardInput.value = '';
            renderAliasRules();
            
            // 추가 완료 시 미리보기 새로고침 제안
            if (aliasPreviewTable.style.display === 'table') {
                previewAliasChangesBtn.click();
            }
        });
    }

    // 미리보기(검수) 렌더링
    if (previewAliasChangesBtn) {
        previewAliasChangesBtn.addEventListener('click', () => {
            if (itemAliasRules.length === 0) {
                alert('등록된 규칙이 없습니다. 먼저 규칙을 추가해주세요.');
                return;
            }

            currentPreviewItems = [];
            // 거래내역을 역순으로 확인 (최신순)
            const reversedTransactions = [...transactions].reverse();
            
            reversedTransactions.forEach((t, reversedIndex) => {
                if (!t.name) return;
                
                // applyItemAlias 코어 로직과 동일하게 시뮬레이션
                const trimName = t.name.trim();
                const lowerName = trimName.toLowerCase();
                let matchedStandard = null;

                for (const rule of itemAliasRules) {
                    const keywordLower = rule.keyword.toLowerCase();
                    if (lowerName.includes(keywordLower)) {
                        const stdLower = rule.standardName.toLowerCase();
                        if (!lowerName.includes(stdLower)) {
                            matchedStandard = rule.standardName;
                            break;
                        }
                    }
                }

                if (matchedStandard && matchedStandard !== t.name) {
                    // 원본 transactions 배열에서의 인덱스 기록 (업데이트를 위함)
                    const originalIndex = transactions.length - 1 - reversedIndex;
                    currentPreviewItems.push({
                        originalIndex,
                        date: t.date,
                        oldName: t.name,
                        newName: matchedStandard
                    });
                }
            });

            if (currentPreviewItems.length === 0) {
                previewEmptyState.style.display = 'block';
                previewEmptyState.innerHTML = '규칙에 해당하는 변환 대상 품목이 없습니다.<br>모두 최신 상태입니다.';
                aliasPreviewTable.style.display = 'none';
                applyPreviewActionDiv.style.display = 'none';
                return;
            }

            // 테이블 렌더링
            previewEmptyState.style.display = 'none';
            aliasPreviewTable.style.display = 'table';
            applyPreviewActionDiv.style.display = 'flex';
            aliasPreviewBody.innerHTML = '';
            
            currentPreviewItems.forEach((item, idx) => {
                const tr = document.createElement('tr');
                tr.className = 'preview-row selected';
                tr.innerHTML = `
                    <td style="text-align: center;"><input type="checkbox" class="preview-checkbox" data-idx="${idx}" checked style="accent-color: #3fbee8; cursor: pointer;"></td>
                    <td>${item.date}</td>
                    <td class="preview-old-name">${item.oldName}</td>
                    <td style="color: #6b7280; text-align: center;">➔</td>
                    <td class="preview-new-name">${item.newName}</td>
                `;
                
                const cb = tr.querySelector('input');
                cb.addEventListener('change', () => {
                    tr.classList.toggle('selected', cb.checked);
                    updatePreviewSelectedCount();
                    
                    // 전체 선택 체크박스 상태 동기화
                    const allCbs = document.querySelectorAll('.preview-checkbox');
                    const checkedCbs = document.querySelectorAll('.preview-checkbox:checked');
                    selectAllPreview.checked = (allCbs.length === checkedCbs.length);
                });
                
                // 행 클릭 시 체크박스 토글 (체크박스 자체 클릭 제외)
                tr.addEventListener('click', (e) => {
                    if (e.target.tagName !== 'INPUT') {
                        cb.checked = !cb.checked;
                        cb.dispatchEvent(new Event('change'));
                    }
                });

                aliasPreviewBody.appendChild(tr);
            });
            
            selectAllPreview.checked = true;
            updatePreviewSelectedCount();
        });
    }

    const updatePreviewSelectedCount = () => {
        const count = document.querySelectorAll('.preview-checkbox:checked').length;
        previewSelectedCount.textContent = `${count}건 선택됨`;
    };

    if (selectAllPreview) {
        selectAllPreview.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.preview-checkbox').forEach(cb => {
                cb.checked = isChecked;
                const tr = cb.closest('tr');
                if (isChecked) tr.classList.add('selected');
                else tr.classList.remove('selected');
            });
            updatePreviewSelectedCount();
        });
    }

    // 검수 완료 후 선택된 항목만 안전 변환
    if (applyPreviewChangesBtn) {
        applyPreviewChangesBtn.addEventListener('click', () => {
            const checkedBoxes = document.querySelectorAll('.preview-checkbox:checked');
            if (checkedBoxes.length === 0) {
                alert('변환할 항목을 1개 이상 선택해주세요.');
                return;
            }

            if (!confirm(`선택한 ${checkedBoxes.length}건의 품목명을 안전하게 변환하시겠습니까?`)) return;

            // 백업 생성
            localStorage.setItem('inventoryData_backup', JSON.stringify(transactions));

            // 인덱스를 기반으로 선택된 항목 변환
            checkedBoxes.forEach(cb => {
                const itemIdx = parseInt(cb.dataset.idx, 10);
                const previewItem = currentPreviewItems[itemIdx];
                // 원본 트랜잭션 업데이트
                if (previewItem && transactions[previewItem.originalIndex]) {
                    transactions[previewItem.originalIndex].name = previewItem.newName;
                }
            });

            saveToLocalStorage();
            renderTable();

            alert(`✅ ${checkedBoxes.length}건의 품목명이 안전하게 변환되었습니다.`);
            
            // 미리보기 리스트 갱신
            previewAliasChangesBtn.click();
        });
    }

    connectToHelper();

    // ─── 초기화 ───
    renderTable();
});
