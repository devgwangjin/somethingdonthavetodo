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
        
        // 정렬 로직 (날짜순, 같은 날짜면 입력된 순서대로 안정 정렬)
        let sortedTransactions = [...transactions];
        sortedTransactions.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            if (dateA.getTime() === dateB.getTime()) {
                return a.id.localeCompare(b.id);
            }
            return isSortAscending ? dateA - dateB : dateB - dateA;
        });

        let lastDate = null;
        sortedTransactions.forEach(item => {
            const displayDate = item.date === lastDate ? '' : item.date;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${displayDate}</td>
                <td>${item.name}</td>
                <td>${item.qty.toLocaleString()}</td>
                <td>${formatCurrency(item.price)}</td>
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
                    transactions[itemIndex].total = newQty * newPrice;
                    saveToLocalStorage();
                    renderTable();
                }
            } else if (target.classList.contains('cancel-edit-btn')) {
                renderTable(); // 수정 취소 시 원래 테이블 렌더링
            }
        };
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
        csvContent += "거래일자,품목,수량,개당단가,총액\n";

        // 정렬된 순서대로 내보내기 위해 정렬 로직 동일하게 적용
        let sortedTransactions = [...transactions].sort((a, b) => {
            return isSortAscending ? new Date(a.date) - new Date(b.date) : new Date(b.date) - new Date(a.date);
        });

        sortedTransactions.forEach(row => {
            const safeName = `"${row.name.replace(/"/g, '""')}"`;
            csvContent += `${row.date},${safeName},${row.qty},${row.price},${row.total}\n`;
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `자재구매내역_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // 초기 테이블 렌더링
    renderTable();
});
