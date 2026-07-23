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

    // ─── 품목 행 관리 ───
    const addItemRow = () => {
        const clone = itemRowTemplate.content.cloneNode(true);
        const row = clone.querySelector('.item-row');

        const qtyInput = row.querySelector('.item-qty');
        const priceInput = row.querySelector('.item-price');
        const totalInput = row.querySelector('.item-total');
        const deleteBtn = row.querySelector('.btn-delete');

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

        transactions = [...transactions, ...newEntries];
        saveToLocalStorage();
        renderTable();

        itemsContainer.innerHTML = '';
        addItemRow();
        calculateGrandTotal();

        alert('성공적으로 저장되었습니다.');
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
                    <button class="edit-row-btn" data-id="${item.id}">수정</button>
                    <button class="delete-row-btn" data-id="${item.id}">삭제</button>
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
                    <button class="save-edit-btn" data-id="${item.id}">저장</button>
                    <button class="cancel-edit-btn">취소</button>
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

    if (aiSettingsBtn && aiSettingsModal) {
        aiSettingsBtn.addEventListener('click', () => {
            loadAiSettings();
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

    // 로컬 헬퍼 프로그램 웹소켓 연동 (ws://localhost:8765)
    let helperSocket = null;
    let helperReconnectTimer = null;

    const connectToHelper = () => {
        if (helperSocket && (helperSocket.readyState === WebSocket.OPEN || helperSocket.readyState === WebSocket.CONNECTING)) {
            const configMsg = {
                type: 'CONFIG_SYNC',
                apiKey: localStorage.getItem('geminiApiKey') || '',
                printerIp: localStorage.getItem('printerIp') || '192.168.0.210',
                printerBoxNum: localStorage.getItem('printerBoxNum') || '006'
            };
            try { helperSocket.send(JSON.stringify(configMsg)); } catch(e){}
            return;
        }

        try {
            helperSocket = new WebSocket('ws://localhost:8765');

            helperSocket.onopen = () => {
                if (helperReconnectTimer) clearTimeout(helperReconnectTimer);
                if (helperStatusBadge) {
                    helperStatusBadge.textContent = '🟢 헬퍼 연동됨';
                    helperStatusBadge.className = 'status-badge status-on';
                }
                const configMsg = {
                    type: 'CONFIG_SYNC',
                    apiKey: localStorage.getItem('geminiApiKey') || '',
                    printerIp: localStorage.getItem('printerIp') || '192.168.0.210',
                    printerBoxNum: localStorage.getItem('printerBoxNum') || '006'
                };
                helperSocket.send(JSON.stringify(configMsg));
            };

            helperSocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'SCAN_PARSED') {
                        fillFormWithAiData(data);
                    }
                } catch (e) {
                    console.error('웹소켓 데이터 파싱 에러:', e);
                }
            };

            helperSocket.onclose = () => {
                if (helperStatusBadge) {
                    helperStatusBadge.textContent = '🔴 헬퍼 미연동';
                    helperStatusBadge.className = 'status-badge status-off';
                }
                if (!helperReconnectTimer) {
                    helperReconnectTimer = setTimeout(() => {
                        helperReconnectTimer = null;
                        connectToHelper();
                    }, 5000);
                }
            };

            helperSocket.onerror = () => {
                if (helperStatusBadge) {
                    helperStatusBadge.textContent = '🔴 헬퍼 미연동';
                    helperStatusBadge.className = 'status-badge status-off';
                }
            };
        } catch (err) {
            console.log('헬퍼 연결 안됨');
        }
    };

    // AI가 분석한 스캔 데이터를 폼에 기입하는 함수
    const fillFormWithAiData = (scanData) => {
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

            scanData.items.forEach(item => {
                addItemRow();
                const lastRow = itemsContainer.lastElementChild;
                if (!lastRow) return;

                const nameInput = lastRow.querySelector('.item-name');
                const qtyInput = lastRow.querySelector('.item-qty');
                const priceInput = lastRow.querySelector('.item-price');
                const totalInput = lastRow.querySelector('.item-total');
                const remarksInput = lastRow.querySelector('.item-remarks');

                if (nameInput) nameInput.value = item.name || '';
                if (qtyInput) qtyInput.value = item.qty || '';
                if (priceInput) priceInput.value = item.price || '';
                if (totalInput) totalInput.value = item.total || (item.qty && item.price ? item.qty * item.price : '');
                if (remarksInput && item.remarks) remarksInput.value = item.remarks;
            });

            calculateGrandTotal();
            alert(`🤖 AI가 스캔된 거래명세서(${scanData.items.length}건)를 읽어 입력했습니다!\n내용을 확인하신 후 [저장하기]를 눌러주세요.`);
        }
    };

    connectToHelper();

    // ─── 초기화 ───
    renderTable();
});
