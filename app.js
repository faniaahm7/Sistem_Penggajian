const TABLES = {
  employees: {
    title: 'Karyawan', singular: 'karyawan', description: 'Kelola informasi karyawan dan jabatan yang ditempati.',
    columns: ['Karyawan', 'Kode', 'Jabatan', 'Email', 'Status'],
    fields: [
      { name: 'full_name', label: 'Nama lengkap', required: true },
      { name: 'employee_code', label: 'Kode karyawan', required: true },
      { name: 'position_id', label: 'Jabatan', type: 'relation', relation: 'positions', required: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Nomor telepon' },
      { name: 'joined_at', label: 'Tanggal bergabung', type: 'date', required: true },
      { name: 'status', label: 'Status', type: 'select', options: [['active', 'Aktif'], ['inactive', 'Tidak aktif']] }
    ]
  },
  positions: {
    title: 'Jabatan', singular: 'jabatan', description: 'Atur daftar jabatan dan gaji pokok setiap posisi.',
    columns: ['Nama jabatan', 'Gaji pokok', 'Keterangan'],
    fields: [
      { name: 'name', label: 'Nama jabatan', required: true },
      { name: 'base_salary', label: 'Gaji pokok (Rp)', type: 'money', required: true },
      { name: 'description', label: 'Keterangan' }
    ]
  },
  salary_components: {
    title: 'Komponen Gaji', singular: 'komponen gaji', description: 'Kelola tunjangan dan potongan berdasarkan jenis dan periode.',
    columns: ['Nama komponen', 'Jenis', 'Karyawan', 'Periode', 'Jumlah', 'Keterangan'],
    fields: [
      { name: 'name', label: 'Nama komponen', required: true },
      { name: 'component_type', label: 'Jenis komponen', type: 'select', required: true, options: [['TUNJANGAN', 'Tunjangan'], ['POTONGAN', 'Potongan']] },
      { name: 'employee_id', label: 'Karyawan', type: 'relation', relation: 'employees', required: true },
      { name: 'period', label: 'Periode', type: 'month', required: true },
      { name: 'amount', label: 'Jumlah (Rp)', type: 'money', required: true },
      { name: 'description', label: 'Keterangan' }
    ]
  },
  attendance: {
    title: 'Absensi', singular: 'absensi', description: 'Catat hari kerja dan jumlah alfa karyawan per bulan.',
    columns: ['Karyawan', 'Periode', 'Hari kerja', 'Alfa'],
    fields: [
      { name: 'employee_id', label: 'Karyawan', type: 'relation', relation: 'employees', required: true },
      { name: 'period', label: 'Periode', type: 'month', required: true },
      { name: 'working_days', label: 'Hari kerja', type: 'number', min: 1, required: true },
      { name: 'alpha_days', label: 'Hari alfa', type: 'number', min: 0, required: true }
    ]
  }
};

const state = { view: 'dashboard', componentType: 'TUNJANGAN', data: { employees: [], positions: [], salary_components: [], attendance: [] }, editingId: null, toastTimer: null };
const storageKey = 'paytrack-supabase-config';
const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function getConfig() {
  let saved = null;
  try { saved = localStorage.getItem(storageKey); } catch { /* Use session storage or the shared config. */ }
  if (!saved) {
    try { saved = sessionStorage.getItem(storageKey); } catch { /* Use the shared config. */ }
  }
  if (saved) {
    try {
      const config = JSON.parse(saved);
      if (config?.url && config?.key) return config;
    } catch { /* Fall back to the shared deployment config. */ }
  }
  const shared = window.PAYTRACK_SUPABASE_CONFIG;
  if (shared?.projectUrl && shared?.publishableKey) return { url: shared.projectUrl, key: shared.publishableKey };
  return null;
}

function saveConfig(config) {
  const serialized = JSON.stringify(config);
  try {
    localStorage.setItem(storageKey, serialized);
    try { sessionStorage.removeItem(storageKey); } catch { /* Persistent storage is sufficient. */ }
    return 'permanent';
  } catch {
    try {
      sessionStorage.setItem(storageKey, serialized);
      return 'session';
    } catch {
      throw new Error('Browser memblokir penyimpanan. Izinkan penyimpanan situs lalu coba lagi.');
    }
  }
}

function setConnection(connected) {
  $('#connection-label').textContent = connected ? 'Supabase terhubung' : 'Belum terhubung';
  $('.status-dot').classList.toggle('online', connected);
}

async function supabaseRequest(table, options = {}) {
  const config = getConfig();
  if (!config?.url || !config?.key) throw new Error('Hubungkan project Supabase terlebih dahulu melalui tombol pengaturan.');
  const headers = { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', ...options.headers };
  const response = await fetch(`${config.url}/rest/v1/${table}${options.query || ''}`, { method: options.method || 'GET', headers, body: options.body ? JSON.stringify(options.body) : undefined });
  if (!response.ok) {
    let detail = `Permintaan gagal (${response.status}).`;
    try { const error = await response.json(); detail = error.message || error.details || detail; } catch { /* Keep the HTTP status message. */ }
    throw new Error(detail);
  }
  const responseBody = await response.text();
  if (!responseBody.trim()) return null;
  return JSON.parse(responseBody);
}

async function loadData(showError = true) {
  if (!getConfig()) {
    setConnection(false);
    updateDashboard();
    $('#settings-dialog').showModal();
    return false;
  }
  try {
    const keys = Object.keys(TABLES);
    const results = await Promise.all(keys.map((table) => supabaseRequest(table, { query: '?select=*&order=created_at.desc' })));
    state.data = Object.fromEntries(keys.map((key, index) => [key, results[index]]));
    setConnection(true);
    updateDashboard();
    if (state.view !== 'dashboard') renderMaster();
    return true;
  } catch (error) {
    setConnection(false);
    if (showError) {
      const missingTable = /schema cache|PGRST205|does not exist/i.test(error.message);
      showToast(missingTable ? 'Struktur database belum diperbarui. Jalankan database/schema.sql di SQL Editor Supabase.' : error.message);
    }
    return false;
  }
}

function formatMoney(value) { return rupiah.format(Number(value) || 0); }
function currentPeriod() { return `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`; }
function formatPeriod(value) {
  const month = String(value || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return '—';
  return new Intl.DateTimeFormat('id-ID', { month: 'short', year: 'numeric' }).format(new Date(`${month}-01T12:00:00`));
}

function updateDashboard() {
  const { employees, positions, salary_components, attendance } = state.data;
  const activeEmployees = employees.filter((employee) => employee.status === 'active');
  const activeIds = new Set(activeEmployees.map((employee) => String(employee.id)));
  const salaryByPosition = new Map(positions.map((position) => [String(position.id), Number(position.base_salary) || 0]));
  const basic = activeEmployees.reduce((total, employee) => total + (salaryByPosition.get(String(employee.position_id)) || 0), 0);
  const period = currentPeriod();
  const currentComponents = salary_components.filter((item) => activeIds.has(String(item.employee_id)) && item.period?.startsWith(period));
  const allowanceTotal = currentComponents.filter((item) => item.component_type === 'TUNJANGAN').reduce((total, item) => total + (Number(item.amount) || 0), 0);
  const deductionTotal = currentComponents.filter((item) => item.component_type === 'POTONGAN').reduce((total, item) => total + (Number(item.amount) || 0), 0);
  const attendanceDeductionTotal = attendance.filter((item) => activeIds.has(String(item.employee_id)) && item.period?.startsWith(period)).reduce((total, item) => {
    const employee = activeEmployees.find((candidate) => String(candidate.id) === String(item.employee_id));
    const salary = employee ? salaryByPosition.get(String(employee.position_id)) || 0 : 0;
    return total + Math.round(salary * (Number(item.alpha_days) || 0) / Math.max(Number(item.working_days) || 0, 1));
  }, 0);
  const net = basic + allowanceTotal - deductionTotal - attendanceDeductionTotal;
  $('#metric-employees').textContent = String(employees.length);
  $('#metric-basic').textContent = formatMoney(basic);
  $('#metric-allowances').textContent = formatMoney(allowanceTotal);
  $('#metric-deductions').textContent = formatMoney(deductionTotal + attendanceDeductionTotal);
  $('#metric-net').textContent = formatMoney(net);
  $('#payroll-total').textContent = formatMoney(net);
  $('#breakdown-basic').textContent = formatMoney(basic);
  $('#breakdown-allowances').textContent = formatMoney(allowanceTotal);
  $('#breakdown-deductions').textContent = `− ${formatMoney(deductionTotal)}`;
  $('#breakdown-attendance').textContent = `− ${formatMoney(attendanceDeductionTotal)}`;
  const max = Math.max(basic + allowanceTotal, 1);
  $('#payroll-bar-fill').style.width = `${Math.min(100, Math.max(0, (net / max) * 100))}%`;
}

function payrollForEmployee(employee) {
  const position = state.data.positions.find((item) => String(item.id) === String(employee.position_id));
  const period = currentPeriod();
  const components = state.data.salary_components.filter((item) => String(item.employee_id) === String(employee.id) && item.period?.startsWith(period));
  const allowances = components.filter((item) => item.component_type === 'TUNJANGAN').reduce((total, item) => total + (Number(item.amount) || 0), 0);
  const deductions = components.filter((item) => item.component_type === 'POTONGAN').reduce((total, item) => total + (Number(item.amount) || 0), 0);
  const basic = Number(position?.base_salary) || 0;
  const attendance = state.data.attendance.find((item) => String(item.employee_id) === String(employee.id) && item.period?.startsWith(period));
  const alphaDays = Number(attendance?.alpha_days) || 0;
  const attendanceDeduction = attendance ? Math.round(basic * alphaDays / Math.max(Number(attendance.working_days) || 0, 1)) : 0;
  return { position: position?.name || '—', basic, allowances, deductions, alphaDays, attendanceDeduction, net: basic + allowances - deductions - attendanceDeduction };
}

function renderPayslipPreview() {
  const employee = state.data.employees.find((item) => String(item.id) === $('#payslip-employee').value);
  if (!employee) {
    $('#payslip-preview').innerHTML = '<p class="payslip-empty">Pilih karyawan untuk melihat rincian slip.</p>';
    return;
  }
  const payroll = payrollForEmployee(employee);
  $('#payslip-preview').innerHTML = `<div class="slip-header"><span class="slip-brand-mark">P</span><span><b>PayTrack</b><small>SLIP GAJI</small></span><span class="slip-period">${escapeHtml(formatPeriod(currentPeriod()))}</span></div><div class="slip-employee"><b>${escapeHtml(employee.full_name)}</b><span>${escapeHtml(employee.employee_code)} · ${escapeHtml(payroll.position)}</span></div><div class="slip-line"><span>Gaji pokok</span><b>${escapeHtml(formatMoney(payroll.basic))}</b></div><div class="slip-line"><span>Tunjangan</span><b>${escapeHtml(formatMoney(payroll.allowances))}</b></div><div class="slip-line"><span>Potongan komponen</span><b>− ${escapeHtml(formatMoney(payroll.deductions))}</b></div><div class="slip-line"><span>Potongan absensi (${escapeHtml(String(payroll.alphaDays))} hari alfa)</span><b>− ${escapeHtml(formatMoney(payroll.attendanceDeduction))}</b></div><div class="slip-total"><span>Gaji bersih</span><b>${escapeHtml(formatMoney(payroll.net))}</b></div>`;
}

function openPayslipDialog() {
  const employees = state.data.employees.filter((employee) => employee.status === 'active');
  if (employees.length === 0) {
    showToast('Belum ada karyawan aktif untuk dibuatkan slip gaji.');
    return;
  }
  $('#payslip-employee').innerHTML = employees.map((employee) => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.full_name)} · ${escapeHtml(employee.employee_code)}</option>`).join('');
  renderPayslipPreview();
  $('#payslip-dialog').showModal();
}

function exportPayrollReport() {
  const period = currentPeriod();
  const rows = [['Periode', 'Kode Karyawan', 'Nama Karyawan', 'Jabatan', 'Gaji Pokok', 'Tunjangan', 'Potongan Komponen', 'Hari Alfa', 'Potongan Absensi', 'Gaji Bersih']];
  state.data.employees.filter((employee) => employee.status === 'active').forEach((employee) => {
    const payroll = payrollForEmployee(employee);
    rows.push([period, employee.employee_code, employee.full_name, payroll.position, payroll.basic, payroll.allowances, payroll.deductions, payroll.alphaDays, payroll.attendanceDeduction, payroll.net]);
  });
  const csvValue = (value) => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = `\uFEFF${rows.map((row) => row.map(csvValue).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `paytrack-payroll-${period}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Laporan payroll berhasil diunduh.');
}

function searchableText(type, row) {
  if (type === 'employees') return `${row.full_name} ${row.employee_code} ${row.email} ${relationName('positions', row.position_id)}`;
  if (type === 'salary_components') return `${row.name} ${row.component_type} ${row.description} ${relationName('employees', row.employee_id)}`;
  if (type === 'attendance') return `${relationName('employees', row.employee_id)} ${row.period} ${row.working_days} ${row.alpha_days}`;
  return `${row.name} ${row.description}`;
}

function relationName(table, id) {
  const row = state.data[table].find((item) => String(item.id) === String(id));
  return row ? (table === 'employees' ? row.full_name : row.name) : '—';
}

function formatThousands(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatMoneyInput(input) {
  const cursor = input.selectionStart ?? input.value.length;
  const digitsBeforeCursor = input.value.slice(0, cursor).replace(/\D/g, '').length;
  input.value = formatThousands(input.value);
  let nextCursor = 0;
  let digitsSeen = 0;
  while (nextCursor < input.value.length && digitsSeen < digitsBeforeCursor) {
    if (/\d/.test(input.value[nextCursor])) digitsSeen++;
    nextCursor++;
  }
  input.setSelectionRange(nextCursor, nextCursor);
}

function rowCells(type, row) {
  if (type === 'employees') {
    const initials = row.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('id');
    return `<td><div class="person-cell"><span class="person-avatar">${escapeHtml(initials)}</span><span><b>${escapeHtml(row.full_name)}</b><small>${escapeHtml(row.phone || '—')}</small></span></div></td><td>${escapeHtml(row.employee_code)}</td><td>${escapeHtml(relationName('positions', row.position_id))}</td><td>${escapeHtml(row.email || '—')}</td><td><span class="status-pill ${row.status === 'inactive' ? 'inactive' : ''}">${row.status === 'inactive' ? 'Tidak aktif' : 'Aktif'}</span></td>`;
  }
  if (type === 'positions') return `<td><b>${escapeHtml(row.name)}</b></td><td>${escapeHtml(formatMoney(row.base_salary))}</td><td>${escapeHtml(row.description || '—')}</td>`;
  if (type === 'salary_components') return `<td><b>${escapeHtml(row.name)}</b></td><td><span class="status-pill ${row.component_type === 'POTONGAN' ? 'inactive' : ''}">${row.component_type === 'POTONGAN' ? 'Potongan' : 'Tunjangan'}</span></td><td>${escapeHtml(relationName('employees', row.employee_id))}</td><td>${escapeHtml(formatPeriod(row.period))}</td><td>${escapeHtml(formatMoney(row.amount))}</td><td>${escapeHtml(row.description || '—')}</td>`;
  if (type === 'attendance') return `<td><b>${escapeHtml(relationName('employees', row.employee_id))}</b></td><td>${escapeHtml(formatPeriod(row.period))}</td><td>${escapeHtml(row.working_days)} hari</td><td><span class="status-pill ${Number(row.alpha_days) ? 'inactive' : ''}">${escapeHtml(row.alpha_days)} hari</span></td>`;
  return '';
}

function renderMaster() {
  const table = TABLES[state.view];
  const isComponents = state.view === 'salary_components';
  const data = (state.data[state.view] || []).filter((row) => !isComponents || row.component_type === state.componentType);
  const query = $('#search-input').value.trim().toLocaleLowerCase('id');
  $('#component-tabs').classList.toggle('hidden', !isComponents);
  document.querySelectorAll('.component-tab').forEach((button) => {
    const active = button.dataset.componentType === state.componentType;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#master-title').textContent = table.title;
  $('#master-description').textContent = table.description;
  const listTitle = isComponents ? state.componentType === 'TUNJANGAN' ? 'tunjangan' : 'potongan' : table.title.toLocaleLowerCase('id');
  $('#table-title').textContent = `Daftar ${listTitle}`;
  $('#master-eyebrow').textContent = `DATA MASTER / ${table.title.toLocaleUpperCase('id')}`;
  $('#record-count').textContent = `${data.length} data`;
  $('#table-head').innerHTML = `<tr>${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}<th>Aksi</th></tr>`;
  const filtered = data.filter((row) => searchableText(state.view, row).toLocaleLowerCase('id').includes(query));
  $('#table-body').innerHTML = filtered.map((row) => `<tr>${rowCells(state.view, row)}<td><div class="row-actions"><button class="row-action" data-edit="${escapeHtml(row.id)}" type="button">Edit</button><button class="row-action delete" data-delete="${escapeHtml(row.id)}" type="button">Hapus</button></div></td></tr>`).join('');
  $('#empty-state').classList.toggle('hidden', filtered.length > 0);
  $('#table-body').classList.toggle('hidden', filtered.length === 0);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $('#dashboard-view').classList.toggle('hidden', view !== 'dashboard');
  $('#master-view').classList.toggle('hidden', view === 'dashboard');
  $('#current-section').textContent = view === 'dashboard' ? 'Dashboard' : TABLES[view].title;
  if (view !== 'dashboard') { $('#search-input').value = ''; renderMaster(); }
}

function fieldMarkup(field, value) {
  const required = field.required ? 'required' : '';
  const escapedValue = escapeHtml(value ?? '');
  const label = `${escapeHtml(field.label)}${field.required ? '<span class="required-mark">*</span>' : ''}`;
  if (field.type === 'relation') {
    const options = state.data[field.relation].map((row) => `<option value="${escapeHtml(row.id)}" ${String(row.id) === String(value) ? 'selected' : ''}>${escapeHtml(field.relation === 'employees' ? row.full_name : row.name)}</option>`).join('');
    return `<label class="field-label"><span class="field-label-text">${label}</span><select name="${field.name}" ${required}><option value="">Pilih ${escapeHtml(field.label.toLocaleLowerCase('id'))}</option>${options}</select></label>`;
  }
  if (field.type === 'select') {
    const selectedValue = value || (field.name === 'component_type' ? state.componentType : 'active');
    return `<label class="field-label"><span class="field-label-text">${label}</span><select name="${field.name}" ${required}>${field.options.map(([option, optionLabel]) => `<option value="${option}" ${option === selectedValue ? 'selected' : ''}>${optionLabel}</option>`).join('')}</select></label>`;
  }
  const isMoney = field.type === 'money';
  const type = isMoney ? 'text' : field.type || 'text';
  const extra = isMoney ? 'inputmode="numeric" autocomplete="off" data-money-input' : type === 'number' ? `min="${field.min || 0}" step="1"` : '';
  const defaultValue = isMoney ? formatThousands(value) : field.type === 'month' ? (value ? String(value).slice(0, 7) : currentPeriod()) : field.name === 'joined_at' && !value ? new Date().toISOString().slice(0, 10) : escapedValue;
  const control = isMoney ? `<span class="money-input-wrap"><span class="money-prefix">Rp</span><input class="money-input" name="${field.name}" type="${type}" value="${defaultValue}" ${extra} ${required}></span>` : `<input name="${field.name}" type="${type}" value="${defaultValue}" ${extra} ${required}>`;
  return `<label class="field-label"><span class="field-label-text">${label}</span>${control}</label>`;
}

function openRecordDialog(id = null) {
  const table = TABLES[state.view];
  const record = id ? state.data[state.view].find((item) => String(item.id) === String(id)) : null;
  if (id && !record) return;
  if (table.fields.some((field) => field.type === 'relation' && state.data[field.relation].length === 0)) {
    showToast('Tambahkan data terkait terlebih dahulu sebelum membuat data ini.');
    return;
  }
  state.editingId = record?.id || null;
  $('#dialog-title').textContent = `${record ? 'Edit' : 'Tambah'} ${table.singular}`;
  $('#dialog-subtitle').textContent = record ? `Perbarui informasi ${table.singular}.` : table.description;
  $('#form-fields').innerHTML = table.fields.map((field) => fieldMarkup(field, record?.[field.name])).join('');
  $('#record-dialog').showModal();
}

async function saveRecord(event) {
  event.preventDefault();
  const record = Object.fromEntries(new FormData(event.currentTarget).entries());
  for (const field of TABLES[state.view].fields) {
    if (field.type === 'number') record[field.name] = Number(record[field.name]);
    if (field.type === 'money') {
      const rawAmount = String(record[field.name]).replace(/\D/g, '');
      const amount = Number(rawAmount);
      if (field.name === 'base_salary' && (!rawAmount || !Number.isSafeInteger(amount) || amount <= 0)) {
        const input = event.currentTarget.elements[field.name];
        input.setCustomValidity('Gaji pokok harus berupa angka lebih dari 0.');
        input.reportValidity();
        return;
      }
      record[field.name] = amount || 0;
    }
    if (field.type === 'month' && record[field.name]) record[field.name] = `${record[field.name]}-01`;
    if (!record[field.name] && !field.required) record[field.name] = null;
  }
  if (state.view === 'attendance' && (!Number.isInteger(record.working_days) || record.working_days < 1 || !Number.isInteger(record.alpha_days) || record.alpha_days < 0 || record.alpha_days > record.working_days)) {
    showToast('Hari kerja harus lebih dari 0 dan hari alfa tidak boleh melebihi hari kerja.');
    return;
  }
  const saveButton = $('#save-button');
  saveButton.disabled = true;
  try {
    if (state.editingId) {
      await supabaseRequest(state.view, { method: 'PATCH', query: `?id=eq.${encodeURIComponent(state.editingId)}`, headers: { Prefer: 'return=minimal' }, body: record });
    } else {
      await supabaseRequest(state.view, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: record });
    }
    $('#record-dialog').close();
    showToast(`${TABLES[state.view].title} berhasil ${state.editingId ? 'diperbarui' : 'ditambahkan'}.`);
    await loadData(false);
    renderMaster();
  } catch (error) { showToast(error.message); }
  finally { saveButton.disabled = false; }
}

async function deleteRecord(id) {
  const record = state.data[state.view].find((item) => String(item.id) === String(id));
  if (!record || !window.confirm(`Hapus data ${record.full_name || record.name}?`)) return;
  try {
    await supabaseRequest(state.view, { method: 'DELETE', query: `?id=eq.${encodeURIComponent(id)}`, headers: { Prefer: 'return=minimal' } });
    showToast('Data berhasil dihapus.');
    await loadData(false);
    renderMaster();
  } catch (error) { showToast(error.message); }
}

async function connectSupabase(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const url = String(form.get('projectUrl')).trim().replace(/\/$/, '');
  const key = String(form.get('publishableKey')).trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) { showToast('Masukkan Project URL Supabase yang valid.'); return; }
  const button = $('#connect-button');
  button.disabled = true;
  try {
    saveConfig({ url, key });
    await supabaseRequest('positions', { query: '?select=id&limit=1' });
    $('#settings-dialog').close();
    setConnection(true);
    const loaded = await loadData(false);
    showToast(loaded ? 'Kredensial Supabase tersimpan dan data berhasil dimuat.' : 'Kredensial tersimpan, tetapi struktur database belum lengkap. Jalankan database/schema.sql di SQL Editor Supabase.');
  } catch (error) {
    setConnection(false);
    showToast(`Kredensial tetap tersimpan. Koneksi gagal: ${error.message}`);
  } finally { button.disabled = false; }
}

function openSettings() {
  const config = getConfig();
  const form = $('#settings-form');
  form.elements.projectUrl.value = config?.url || '';
  form.elements.publishableKey.value = config?.key || '';
  $('#settings-dialog').showModal();
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove('visible'), 3600);
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$('#settings-button').addEventListener('click', openSettings);
$('#profile-button').addEventListener('click', openSettings);
$('#add-button').addEventListener('click', () => openRecordDialog());
$('#component-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-component-type]');
  if (!button) return;
  state.componentType = button.dataset.componentType;
  $('#search-input').value = '';
  renderMaster();
});
$('#quick-access-grid').addEventListener('click', (event) => {
  const action = event.target.closest('[data-quick-action]')?.dataset.quickAction;
  if (action === 'process-payroll') {
    const button = event.target.closest('[data-quick-action]');
    button.disabled = true;
    loadData().then((loaded) => {
      if (!loaded) return;
      showToast(`Estimasi payroll ${formatPeriod(currentPeriod())} dihitung ulang.`);
      $('#payroll-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }).finally(() => { button.disabled = false; });
  } else if (action === 'add-employee') {
    setView('employees');
    openRecordDialog();
  } else if (action === 'print-payslip') {
    openPayslipDialog();
  } else if (action === 'export-payroll') {
    exportPayrollReport();
  }
});
$('#payslip-employee').addEventListener('change', renderPayslipPreview);
$('#print-payslip-button').addEventListener('click', () => window.print());
$('#record-form').addEventListener('submit', saveRecord);
$('#record-form').addEventListener('input', (event) => {
  if (event.target.matches('[data-money-input]')) {
    formatMoneyInput(event.target);
    event.target.setCustomValidity('');
  }
});
$('#record-form').addEventListener('beforeinput', (event) => {
  if (event.target.matches('[data-money-input]') && event.data && /[^\d.]/.test(event.data)) event.preventDefault();
});
$('#settings-form').addEventListener('submit', connectSupabase);
$('#search-input').addEventListener('input', renderMaster);
$('#table-body').addEventListener('click', (event) => {
  const editButton = event.target.closest('[data-edit]');
  const deleteButton = event.target.closest('[data-delete]');
  if (editButton) openRecordDialog(editButton.dataset.edit);
  if (deleteButton) deleteRecord(deleteButton.dataset.delete);
});
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));

const now = new Date();
const period = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(now);
const greeting = now.getHours() < 11 ? 'Pagi' : now.getHours() < 15 ? 'Siang' : now.getHours() < 18 ? 'Sore' : 'Malam';
$('#today-label').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
$('#greeting-text').textContent = `Selamat ${greeting}, Admin!`;
$('#period-label').textContent = period;
$('#period-chip').textContent = period;
$('#quick-access-period').textContent = period;
loadData();