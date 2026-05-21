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

    // 검색 이벤트 리스너
    let searchQuery = '';
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim().toLowerCase();
            currentPage = 1; // 검색 시 첫 페이지로 이동
            renderTable();
        });
    }

    // 날짜 하이픈 자동 변환 (숫자만 쳐도 자동으로 2026-04-17 형태로)
    transactionDateInput.addEventListener('input', (e) => {
        let val = e.target.value.replace(/[^0-9]/g, '');
        if (val.length > 8) val = val.substring(0, 8);
        if (val.length >= 6) {
            val = val.substring(0,4) + '-' + val.substring(4,6) + '-' + val.substring(6);
        } else if (val.length >= 4) {
            val = val.substring(0,4) + '-' + val.substring(4);
        }
        e.target.value = val;
    });

    // 기본 오늘 날짜 세팅
    const today = new Date().toISOString().split('T')[0];
    transactionDateInput.value = today;

    let transactions = JSON.parse(localStorage.getItem('inventoryData')) || [];
    let isSortAscending = true; // 기본 정렬 상태 (오름차순/과거순)
    
    // 페이지네이션 상태
    let currentPage = 1;
    const rowsPerPage = 20; // 한 페이지당 보여줄 항목 수
    const paginationContainer = document.getElementById('paginationContainer');

    // 통화 포맷 함수
    const formatCurrency = (num) => {
        return num.toLocaleString('ko-KR');
    };

    // 품목 행 추가 함수
    const addItemRow = () => {
        const clone = itemRowTemplate.content.cloneNode(true);
        const row = clone.querySelector('.item-row');
        
        const qtyInput = row.querySelector('.item-qty');
        const priceInput = row.querySelector('.item-price');
        const deleteBtn = row.querySelector('.btn-delete');
        
        // 입력 변경 시 자동 계산
        const calculateRowTotal = () => {
            const qty = parseFloat(qtyInput.value) || 0;
            const price = parseFloat(priceInput.value) || 0;
            const total = qty * price;
            row.querySelector('.item-total').textContent = formatCurrency(total);
            calculateGrandTotal();
        };

        qtyInput.addEventListener('input', calculateRowTotal);
        priceInput.addEventListener('input', calculateRowTotal);

        // 삭제 버튼 이벤트
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

    // 전체 영수증 총계 계산
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

    // 초기 행 1개 추가
    addItemRow();

    // 품목 추가 버튼 클릭
    addItemBtn.addEventListener('click', addItemRow);

    // 저장 버튼 클릭 (영수증 일괄 저장)
    saveTransactionBtn.addEventListener('click', () => {
        const date = transactionDateInput.value;
        if (!date) {
            alert('거래일자를 선택해주세요.');
            return;
        }

        const rows = itemsContainer.querySelectorAll('.item-row');
        let isValid = true;
        let newEntries = [];

        rows.forEach(row => {
            const name = row.querySelector('.item-name').value.trim();
            const qty = parseFloat(row.querySelector('.item-qty').value);
            const price = parseFloat(row.querySelector('.item-price').value);
            const remarks = row.querySelector('.item-remarks').value.trim();

            // 값이 입력되어 있는 행만 저장 (비어있는 행 무시)
            if (name || !isNaN(qty) || !isNaN(price)) {
                if (!name || isNaN(qty) || isNaN(price)) {
                    isValid = false; // 일부만 채워진 경우 에러
                } else {
                    newEntries.push({
                        id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
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

        // 기존 데이터에 병합
        transactions = [...transactions, ...newEntries];
        saveToLocalStorage();
        renderTable();
        
        // 폼 초기화
        itemsContainer.innerHTML = '';
        addItemRow();
        calculateGrandTotal();
        
        alert('성공적으로 저장되었습니다.');
    });

    // 로컬 스토리지에 저장
    const saveToLocalStorage = () => {
        localStorage.setItem('inventoryData', JSON.stringify(transactions));
    };

    // 테이블 렌더링
    const renderTable = () => {
        dataTableBody.innerHTML = '';
        
        // 1. 검색 필터링
        let filteredTransactions = transactions.filter(item => {
            if (!searchQuery) return true;
            const searchLower = searchQuery.toLowerCase();
            return item.name.toLowerCase().includes(searchLower) || 
                   item.date.includes(searchLower) || 
                   (item.remarks && item.remarks.toLowerCase().includes(searchLower));
        });
        
        // 2. 정렬 로직 (날짜순, 같은 날짜면 입력된 순서대로 안정 정렬)
        let sortedTransactions = [...filteredTransactions];
        sortedTransactions.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            if (dateA.getTime() === dateB.getTime()) {
                return a.id.localeCompare(b.id);
            }
            return isSortAscending ? dateA - dateB : dateB - dateA;
        });

        // 페이지네이션 계산
        const totalPages = Math.ceil(sortedTransactions.length / rowsPerPage) || 1;
        if (currentPage > totalPages) currentPage = totalPages;

        const startIndex = (currentPage - 1) * rowsPerPage;
        const endIndex = startIndex + rowsPerPage;
        const paginatedData = sortedTransactions.slice(startIndex, endIndex);

        let lastDate = null;
        paginatedData.forEach(item => {
            const displayDate = item.date === lastDate ? '' : item.date;
            
            const tr = document.createElement('tr');
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
            lastDate = item.date;
        });

        // 수정/삭제 이벤트 위임
        dataTableBody.onclick = (e) => {
            const target = e.target;
            if (target.classList.contains('delete-row-btn')) {
                if(confirm('정말 이 항목을 삭제하시겠습니까?')) {
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
                    <td>${formatCurrency(item.total)}</td>
                    <td style="white-space: nowrap;">
                        <button class="save-edit-btn" data-id="${item.id}">저장</button>
                        <button class="cancel-edit-btn">취소</button>
                    </td>
                `;

                // 날짜 하이픈 자동 변환 (수정 폼 내)
                const editDateInput = tr.querySelector('.edit-date');
                editDateInput.addEventListener('input', (ev) => {
                    let val = ev.target.value.replace(/[^0-9]/g, '');
                    if (val.length > 8) val = val.substring(0, 8);
                    if (val.length >= 6) {
                        val = val.substring(0,4) + '-' + val.substring(4,6) + '-' + val.substring(6);
                    } else if (val.length >= 4) {
                        val = val.substring(0,4) + '-' + val.substring(4);
                    }
                    ev.target.value = val;
                });
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
                renderTable(); // 수정 취소 시 원래 테이블 렌더링
            }
        };
        
        renderPagination(totalPages);
    };

    // 페이지네이션 렌더링 함수
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

        // 페이지 번호
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        if (endPage - startPage < 4) {
            startPage = Math.max(1, endPage - 4);
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

    // 날짜 정렬 버튼 클릭
    sortDateBtn.addEventListener('click', () => {
        isSortAscending = !isSortAscending;
        const icon = sortDateBtn.querySelector('.sort-icon');
        icon.textContent = isSortAscending ? '↓' : '↑';
        renderTable();
    });

    // CSV 내보내기 기능
    exportCsvBtn.addEventListener('click', () => {
        if(transactions.length === 0) {
            alert('내보낼 데이터가 없습니다.');
            return;
        }

        let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; // 한글 깨짐 방지 BOM 추가
        csvContent += "거래일자,품목,수량,개당단가,비고,총액\n";

        // 정렬된 순서대로 내보내기 위해 정렬 로직 동일하게 적용
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

    // CSV 복원(불러오기) 및 되돌리기 기능
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
                localStorage.removeItem('inventoryData_backup'); // 되돌린 후 백업본 삭제
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
                // 첫 줄(헤더) 제외하고 파싱
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
                            newEntries.push({
                                id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
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

                const isOverwrite = confirm('기존 데이터를 모두 지우고 이 백업 파일의 내용으로 덮어쓰시겠습니까?\\n(취소를 누르시면 기존 데이터 아래에 추가로 병합됩니다.)');
                if (isOverwrite) {
                    transactions = newEntries;
                } else {
                    transactions = [...transactions, ...newEntries];
                }
                
                saveToLocalStorage();
                renderTable();
                alert('데이터 복원이 완료되었습니다! 🎉');
                importCsvInput.value = ''; // 파일 선택 초기화
            };
            reader.readAsText(file, 'utf-8');
        });
    }

    // 초기 테이블 렌더링
    renderTable();
});
