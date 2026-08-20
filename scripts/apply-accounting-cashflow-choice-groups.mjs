import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

function replaceOnce(source, search, replacement, label) {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`Transform miss: ${label}`);
  return next;
}

// 1) Accounting Cash Flow bridge: prefer Choice Group for new facts, preserve legacy fixed-rule facts.
{
  const path = 'src/accounting-cash-flow-bridge.js';
  let source = readFileSync(path, 'utf8');
  source = replaceOnce(source,
    /export async function listCashFlowCounterpartOptions[\s\S]*?\nasync function loadCashAccount/,
`function cashFlowContext(direction) {
  const normalizedDirection = text(direction, 8).toUpperCase();
  if (!['IN', 'OUT'].includes(normalizedDirection)) return null;
  return {
    direction: normalizedDirection,
    categoryCode: normalizedDirection === 'OUT' ? 'cash_flow_out' : 'cash_flow_in',
    expectedSide: normalizedDirection === 'OUT' ? 'DEBIT' : 'CREDIT'
  };
}

function choiceSelections(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => ({
    groupCode: text(item?.groupCode, 48).toUpperCase(),
    optionCode: text(item?.optionCode, 48).toUpperCase()
  })).filter(item => item.groupCode && item.optionCode);
}

export async function listCashFlowCounterpartOptions(db, storeId) {
  const choiceRules = await db.prepare(\`
    SELECT r.id AS journal_rule_id, r.label AS rule_label, r.side,
           c.code AS category_code, g.id AS group_id, g.code AS group_code, g.name AS group_name
    FROM journal_rules r
    JOIN transaction_categories c
      ON c.id = r.transaction_category_id AND c.store_id = r.store_id AND c.is_active = 1
    JOIN accounting_choice_groups g
      ON g.id = r.choice_group_id AND g.store_id = r.store_id AND g.is_active = 1
    WHERE r.store_id = ? AND r.is_active = 1 AND r.source_type = 'choice_group'
      AND ((c.code = 'cash_flow_in' AND r.side = 'CREDIT')
        OR (c.code = 'cash_flow_out' AND r.side = 'DEBIT'))
    ORDER BY c.code, r.sort_order, r.id
  \`).bind(storeId).all();

  const choiceRows = await db.prepare(\`
    SELECT r.id AS journal_rule_id, r.label AS rule_label,
           c.code AS category_code, g.code AS group_code, g.name AS group_name,
           o.code AS option_code, o.name AS option_name, o.is_default,
           o.account_id, a.id AS active_account_id, a.code AS account_code, a.name AS account_name
    FROM journal_rules r
    JOIN transaction_categories c
      ON c.id = r.transaction_category_id AND c.store_id = r.store_id AND c.is_active = 1
    JOIN accounting_choice_groups g
      ON g.id = r.choice_group_id AND g.store_id = r.store_id AND g.is_active = 1
    JOIN accounting_choice_options o
      ON o.choice_group_id = g.id AND o.store_id = g.store_id AND o.is_active = 1
    LEFT JOIN chart_of_accounts a
      ON a.id = o.account_id AND a.store_id = o.store_id AND a.is_active = 1
    WHERE r.store_id = ? AND r.is_active = 1 AND r.source_type = 'choice_group'
      AND ((c.code = 'cash_flow_in' AND r.side = 'CREDIT')
        OR (c.code = 'cash_flow_out' AND r.side = 'DEBIT'))
    ORDER BY c.code, o.is_default DESC, o.sort_order, o.code, o.id
  \`).bind(storeId).all();

  const legacyRows = await db.prepare(\`
    SELECT r.id AS journal_rule_id, r.label, r.side, r.fixed_account_id, r.is_default,
           c.code AS category_code, a.id AS active_account_id, a.code AS account_code, a.name AS account_name
    FROM journal_rules r
    JOIN transaction_categories c
      ON c.id = r.transaction_category_id AND c.store_id = r.store_id AND c.is_active = 1
    LEFT JOIN chart_of_accounts a
      ON a.id = r.fixed_account_id AND a.store_id = r.store_id AND a.is_active = 1
    WHERE r.store_id = ? AND r.is_active = 1 AND r.source_type = 'fixed_account'
      AND ((c.code = 'cash_flow_in' AND r.side = 'CREDIT')
        OR (c.code = 'cash_flow_out' AND r.side = 'DEBIT'))
    ORDER BY c.code, r.is_default DESC, r.sort_order, r.id
  \`).bind(storeId).all();

  const configuredChoiceDirections = new Set((choiceRules.results ?? []).map(row => row.category_code === 'cash_flow_out' ? 'OUT' : 'IN'));
  const choices = (choiceRows.results ?? []).map(row => ({
    direction: row.category_code === 'cash_flow_out' ? 'OUT' : 'IN',
    selectionKind: 'choice_group',
    journalRuleId: row.journal_rule_id,
    groupCode: row.group_code,
    groupName: row.group_name,
    optionCode: row.option_code,
    isDefault: Boolean(row.is_default),
    label: row.option_name,
    accountCode: row.account_code || '',
    accountName: row.account_name || '',
    accountingReady: Boolean(row.account_id && row.active_account_id)
  }));
  const legacy = (legacyRows.results ?? []).map(row => ({
    direction: row.category_code === 'cash_flow_out' ? 'OUT' : 'IN',
    selectionKind: 'legacy_fixed_rule',
    journalRuleId: row.journal_rule_id,
    isDefault: Boolean(row.is_default),
    label: row.label,
    accountCode: row.account_code || '',
    accountName: row.account_name || '',
    accountingReady: Boolean(row.fixed_account_id && row.active_account_id)
  }));

  return ['IN', 'OUT'].flatMap(direction => configuredChoiceDirections.has(direction)
    ? choices.filter(option => option.direction === direction)
    : legacy.filter(option => option.direction === direction));
}

export async function resolveCashFlowCounterpartOption(db, storeId, direction, selector) {
  const context = cashFlowContext(direction);
  if (!context) return null;
  const legacyRuleId = text(typeof selector === 'string' ? selector : selector?.journalRuleId, 180);
  const requestedChoices = choiceSelections(typeof selector === 'object' && selector ? selector.choiceSelections : []);

  const choiceRules = await db.prepare(\`
    SELECT r.id AS journal_rule_id, r.label, r.side,
           g.id AS group_id, g.code AS group_code, g.name AS group_name
    FROM journal_rules r
    JOIN transaction_categories c
      ON c.id = r.transaction_category_id AND c.store_id = r.store_id AND c.is_active = 1
    JOIN accounting_choice_groups g
      ON g.id = r.choice_group_id AND g.store_id = r.store_id AND g.is_active = 1
    WHERE r.store_id = ? AND r.is_active = 1 AND r.source_type = 'choice_group'
      AND r.side = ? AND c.code = ?
    ORDER BY r.sort_order, r.id
  \`).bind(storeId, context.expectedSide, context.categoryCode).all();
  const choiceRuleRows = choiceRules.results ?? [];

  if (requestedChoices.length) {
    for (const rule of choiceRuleRows) {
      const selected = requestedChoices.find(item => item.groupCode === String(rule.group_code || '').toUpperCase());
      if (!selected) continue;
      const option = await db.prepare(\`
        SELECT o.code AS option_code, o.name AS option_name, o.account_id,
               a.id AS active_account_id, a.code AS account_code, a.name AS account_name
        FROM accounting_choice_options o
        LEFT JOIN chart_of_accounts a
          ON a.id = o.account_id AND a.store_id = o.store_id AND a.is_active = 1
        WHERE o.store_id = ? AND o.choice_group_id = ? AND o.code = ? AND o.is_active = 1
        LIMIT 1
      \`).bind(storeId, rule.group_id, selected.optionCode).first();
      if (!option) return null;
      return {
        selectionKind: 'choice_group',
        journalRuleId: rule.journal_rule_id,
        side: rule.side,
        label: option.option_name || rule.label,
        accountId: option.account_id || null,
        accountCode: option.account_code || '',
        accountName: option.account_name || '',
        choiceGroupCode: rule.group_code,
        choiceOptionCode: option.option_code,
        errorCode: option.account_id && option.active_account_id ? '' : 'NEEDS_CHOICE_ACCOUNT'
      };
    }
    return null;
  }

  // Once a Choice Group is attached, a new request must select by stable codes.
  // Explicit legacy journalRuleId remains valid only for facts queued before migration.
  if (choiceRuleRows.length && !legacyRuleId) return null;

  const legacyRows = await db.prepare(\`
    SELECT r.id AS journal_rule_id, r.label, r.side, r.fixed_account_id,
           a.id AS active_account_id, a.code AS account_code, a.name AS account_name
    FROM journal_rules r
    JOIN transaction_categories c
      ON c.id = r.transaction_category_id AND c.store_id = r.store_id AND c.is_active = 1
    LEFT JOIN chart_of_accounts a
      ON a.id = r.fixed_account_id AND a.store_id = r.store_id AND a.is_active = 1
    WHERE r.store_id = ? AND r.is_active = 1 AND r.source_type = 'fixed_account'
      AND r.side = ? AND c.code = ?
      AND (? = '' OR r.id = ?)
    ORDER BY r.is_default DESC, r.sort_order, r.id
  \`).bind(storeId, context.expectedSide, context.categoryCode, legacyRuleId, legacyRuleId).all();
  const rows = legacyRows.results ?? [];
  const row = legacyRuleId ? rows[0] : rows.length === 1 ? rows[0] : null;
  if (!row) return null;
  return {
    selectionKind: 'legacy_fixed_rule',
    journalRuleId: row.journal_rule_id,
    side: row.side,
    label: row.label,
    accountId: row.fixed_account_id || null,
    accountCode: row.account_code || '',
    accountName: row.account_name || '',
    errorCode: row.fixed_account_id && row.active_account_id ? '' : 'NEEDS_FIXED_ACCOUNT'
  };
}

async function loadCashAccount`,
    'cash flow selection functions');

  source = replaceOnce(source,
    /  let payload = \{\};[\s\S]*?  const cash = await loadCashAccount\(db, storeId\);/,
`  let payload = {};
  try { payload = JSON.parse(source.payload_json || '{}'); } catch {}
  const paymentRules = rules.filter(rule => rule.source_type === 'payment_method');
  if (paymentRules.length !== 1 || rules.some(rule => !['payment_method', 'fixed_account', 'choice_group'].includes(rule.source_type))) {
    const value = bridgeResult('NEEDS_CONFIGURATION', 'NEEDS_MAPPING', \`Aturan \${categoryCode} wajib memiliki tepat satu payment_method dan counterpart fixed_account/choice_group yang didukung.\`);
    await saveDelivery(db, storeId, requestId, categoryCode, value);
    return value;
  }

  const counterpart = await resolveCashFlowCounterpartOption(db, storeId, source.direction, {
    journalRuleId: payload.accountingCounterpartRuleId,
    choiceSelections: payload.choiceSelections
  });
  if (!counterpart || paymentRules[0].side === counterpart.side) {
    const value = bridgeResult('NEEDS_CONFIGURATION', 'NEEDS_COUNTERPART_SELECTION', 'Akun lawan Arus Kas belum dipilih atau tidak cocok dengan arah transaksi.');
    await saveDelivery(db, storeId, requestId, categoryCode, value);
    return value;
  }
  if (counterpart.errorCode) {
    const error = counterpart.errorCode === 'NEEDS_CHOICE_ACCOUNT'
      ? 'Pilihan Setting Transaksi belum terhubung ke akun aktif.'
      : 'Akun lawan Arus Kas legacy belum aktif.';
    const value = bridgeResult('NEEDS_CONFIGURATION', counterpart.errorCode, error);
    await saveDelivery(db, storeId, requestId, categoryCode, value);
    return value;
  }

  const cash = await loadCashAccount(db, storeId);`,
    'cash flow dispatch selection');

  source = replaceOnce(source,
`  if (!counterpartRule.active_fixed_account_id) {
    const value = bridgeResult('NEEDS_CONFIGURATION', 'NEEDS_FIXED_ACCOUNT', 'Akun lawan Arus Kas belum aktif.');
    await saveDelivery(db, storeId, requestId, categoryCode, value);
    return value;
  }

`, '', 'remove legacy-only account guard');

  source = replaceOnce(source,
/      journalLines: \[paymentRules\[0\], counterpartRule\]\.map\(rule => \(\{[\s\S]*?      \}\)\)\n/,
`      journalLines: [
        {
          accountId: cash.account_id,
          side: paymentRules[0].side,
          amountScaled,
          description: paymentRules[0].label || source.description
        },
        {
          accountId: counterpart.accountId,
          side: counterpart.side,
          amountScaled,
          description: counterpart.label || source.description,
          ...(counterpart.selectionKind === 'choice_group' ? {
            choiceGroupCode: counterpart.choiceGroupCode,
            choiceOptionCode: counterpart.choiceOptionCode
          } : {})
        }
      ]
`, 'journal lines with choice provenance');

  writeFileSync(path, source);
}

// 2) Operasional writer: new facts carry stable Choice Group codes, old facts keep journalRuleId compatibility.
{
  const path = 'src/operational-posting.js';
  let source = readFileSync(path, 'utf8');
  source = replaceOnce(source,
/  if \(requestType === 'CASH_FLOW'\) \{[\s\S]*?\n  \}\n\n  if \(requestType === 'GOODS_FLOW'\)/,
`  if (requestType === 'CASH_FLOW') {
    const direction = String(payload.direction || '').toUpperCase();
    const amount = positiveInteger(payload.amount);
    const description = text(payload.description, 220);
    if (!['IN', 'OUT'].includes(direction) || !amount || !description) return { ok: false, error: 'Arus Kas membutuhkan arah, nominal positif, dan deskripsi.' };
    const counterpart = await resolveCashFlowCounterpartOption(db, storeId, direction, {
      journalRuleId: payload.accountingCounterpartRuleId,
      choiceSelections: payload.choiceSelections
    });
    if (!counterpart || counterpart.errorCode) return { ok: false, error: 'Pilih akun lawan Arus Kas yang aktif dan sesuai arah dari Setting Akuntansi.' };

    const normalized = {
      direction,
      amount,
      description,
      note: text(payload.note, 500)
    };
    if (counterpart.selectionKind === 'choice_group') {
      normalized.choiceSelections = [{
        groupCode: counterpart.choiceGroupCode,
        optionCode: counterpart.choiceOptionCode
      }];
    } else {
      // Compatibility snapshot for requests created before Cash Flow moved to Choice Group.
      normalized.accountingCounterpartRuleId = counterpart.journalRuleId;
      normalized.accountingCounterpartLabel = counterpart.label;
      normalized.accountingCounterpartAccountCode = counterpart.accountCode;
      normalized.accountingCounterpartAccountName = counterpart.accountName;
    }
    return { ok: true, payload: normalized };
  }

  if (requestType === 'GOODS_FLOW')`,
    'operational cash flow normalize');
  writeFileSync(path, source);
}

// 3) Cashier UI: submit stable group/option codes for canonical config; retain legacy selector when only old config exists.
{
  const path = 'public/cashier-approval-actions.js';
  let source = readFileSync(path, 'utf8');
  source = replaceOnce(source,
/  function cashFlowDialog\(\) \{[\s\S]*?\n  \}\n\n  function goodsFlowDialog\(\)/,
`  function cashFlowDialog() {
    const counterparts = state.cashFlowCounterparts || [];
    const optionsForDirection = direction => counterparts.filter(option => option.direction === direction);
    const optionMarkup = direction => optionsForDirection(direction).map((option, index) => {
      const kind = option.selectionKind || (option.groupCode && option.optionCode ? 'choice_group' : 'legacy_fixed_rule');
      const ready = option.accountingReady !== false;
      const groupLabel = kind === 'choice_group' && option.groupName ? \`\${option.groupName} · \` : '';
      const accountLabel = option.accountCode ? \`\${option.accountCode} — \${option.accountName}\` : 'Belum linked akun';
      return \`<option value="\${index}" data-kind="\${escapeHtml(kind)}" data-group-code="\${escapeHtml(option.groupCode || '')}" data-option-code="\${escapeHtml(option.optionCode || '')}" data-journal-rule-id="\${escapeHtml(option.journalRuleId || '')}"\${option.isDefault ? ' data-default="1"' : ''}\${ready ? '' : ' disabled'}>\${escapeHtml(groupLabel + (option.label || 'Akun lawan'))} · \${escapeHtml(accountLabel)}\${option.isDefault ? ' · Default' : ''}\${ready ? '' : ' · Belum siap'}</option>\`;
    }).join('');

    openDialog({
      eyebrow: 'Laci · Approval Queue',
      title: 'Arus Kas',
      body: \`
        <div class="field"><label>Arah arus</label><select id="approvalCashDirection" class="text-input"><option value="IN">Kas Masuk</option><option value="OUT">Kas Keluar</option></select></div>
        <div class="field"><label>Akun lawan</label><select id="approvalCashCounterpart" class="text-input" required></select></div>
        <div class="field"><label>Nominal</label><input id="approvalCashAmount" class="text-input" type="number" min="1" step="1" required /></div>
        <div class="field"><label>Deskripsi</label><input id="approvalCashDescription" class="text-input" maxlength="220" required /></div>
        <div class="field"><label>Catatan</label><textarea id="approvalCashNote" rows="2" maxlength="500"></textarea></div>
        <p id="approvalCashCounterpartHelp" class="muted">Pilihan berasal dari Setting Transaksi. Entry tetap unposted sampai ACC Admin/Owner.</p>\`,
      submitText: 'AJUKAN ARUS KAS',
      onSubmit: async () => {
        const amount = Number(el('approvalCashAmount').value);
        if (!Number.isInteger(amount) || amount <= 0) throw new Error('Nominal arus kas wajib bilangan bulat lebih dari 0.');
        const selected = el('approvalCashCounterpart')?.selectedOptions?.[0];
        if (!selected || selected.disabled || !selected.value) throw new Error('Setting Akuntansi belum memiliki pilihan akun lawan aktif untuk arah Arus Kas ini.');
        const payload = {
          direction: el('approvalCashDirection').value,
          amount,
          description: el('approvalCashDescription').value.trim(),
          note: el('approvalCashNote').value.trim()
        };
        if (selected.dataset.kind === 'choice_group') {
          payload.choiceSelections = [{
            groupCode: selected.dataset.groupCode,
            optionCode: selected.dataset.optionCode
          }];
        } else {
          payload.accountingCounterpartRuleId = selected.dataset.journalRuleId;
        }
        await submitApprovalRequest('CASH_FLOW', payload);
        return true;
      }
    });
    const direction = el('approvalCashDirection');
    const counterpart = el('approvalCashCounterpart');
    const syncCounterparts = () => {
      const options = optionMarkup(direction.value);
      counterpart.innerHTML = options || '<option value="">Belum diatur / belum siap di Setting Akuntansi</option>';
      const defaultOption = counterpart.querySelector('[data-default="1"]:not([disabled])');
      const firstReady = counterpart.querySelector('option:not([disabled])');
      if (defaultOption) counterpart.value = defaultOption.value;
      else if (firstReady) counterpart.value = firstReady.value;
      counterpart.disabled = !firstReady;
    };
    direction?.addEventListener('change', syncCounterparts);
    syncCounterparts();
  }

  function goodsFlowDialog()`,
    'cashier cash flow dialog');
  writeFileSync(path, source);
}

// 4) Flow Preset: migrate Cash Flow shortcut onto canonical Choice Groups while keeping legacy fixed rules for queued facts.
{
  const path = 'public/admin-accounting-flow-presets.js';
  let source = readFileSync(path, 'utf8');
  source = source
    .replace("{ side: 'CREDIT', sourceType: 'fixed_account', label: 'Akun lawan arus kas masuk', sortOrder: 20 }", "{ side: 'CREDIT', sourceType: 'choice_group', label: 'Pilihan akun lawan arus kas masuk', sortOrder: 20 }")
    .replace("{ side: 'DEBIT', sourceType: 'fixed_account', label: 'Akun lawan arus kas keluar', sortOrder: 10 }", "{ side: 'DEBIT', sourceType: 'choice_group', label: 'Pilihan akun lawan arus kas keluar', sortOrder: 10 }");

  source = replaceOnce(source,
/  function configuredCounterparts\(code\) \{[\s\S]*?\n  \}\n\n  function warehouseReference/,
`  function configuredCounterparts(code) {
    const tx = (accounting?.transactionCategories || []).find(item => item.code === code);
    const activeRules = (tx?.rules || []).filter(rule => rule.isActive);
    const choiceRule = activeRules.find(rule => rule.sourceType === 'choice_group');
    if (choiceRule) {
      const group = (accounting?.choiceGroups || []).find(item => item.id === choiceRule.choiceGroupId);
      const options = (group?.options || []).filter(option => option.isActive);
      if (!options.length) return '<span class="acc-muted">Setting Transaksi belum punya pilihan aktif.</span>';
      return options.map(option => \`<span class="acc-chip \${option.isDefault ? 'ok' : option.accountingReady ? '' : 'warn'}">\${esc(option.account?.code || '')} \${esc(option.account?.name || option.name)}\${option.isDefault ? ' · DEFAULT' : ''}\${option.accountingReady ? '' : ' · BELUM LINK AKUN'}\${option.isDefault ? '' : \` <button type="button" class="acc-mini" data-default-flow-option="\${esc(option.id)}" data-default-flow-code="\${esc(code)}">Jadikan default</button>\`}</span>\`).join(' ');
    }
    const legacyRules = activeRules.filter(rule => rule.sourceType === 'fixed_account');
    if (!legacyRules.length) return '<span class="acc-muted">Belum ada akun lawan.</span>';
    return legacyRules.map(rule => \`<span class="acc-chip \${rule.isDefault ? 'ok' : ''}">\${esc(rule.fixedAccount?.code)} \${esc(rule.fixedAccount?.name)}\${rule.isDefault ? ' · DEFAULT · LEGACY' : ' · LEGACY'}\${rule.isDefault ? '' : \` <button type="button" class="acc-mini" data-default-flow-rule="\${esc(rule.id)}" data-default-flow-code="\${esc(code)}">Jadikan default</button>\`}</span>\`).join(' ');
  }

  function warehouseReference`, 'flow preset configured counterparts');

  source = source.replace(
    "rule.sourceType === 'fixed_account' ? 'akun lawan pilihan' : rule.sourceType",
    "rule.sourceType === 'fixed_account' ? 'akun lawan pilihan' : rule.sourceType === 'choice_group' ? 'Setting Transaksi akun lawan' : rule.sourceType"
  );
  source = replaceOnce(source,
`    host.querySelectorAll('[data-default-flow-rule]').forEach(button => button.addEventListener('click', () => setDefaultCounterpart(button.dataset.defaultFlowCode, button.dataset.defaultFlowRule)));
`,
`    host.querySelectorAll('[data-default-flow-rule]').forEach(button => button.addEventListener('click', () => setDefaultCounterpart(button.dataset.defaultFlowCode, button.dataset.defaultFlowRule)));
    host.querySelectorAll('[data-default-flow-option]').forEach(button => button.addEventListener('click', () => setDefaultChoiceOption(button.dataset.defaultFlowCode, button.dataset.defaultFlowOption)));
`, 'choice default event');

  source = replaceOnce(source,
/  async function setDefaultCounterpart\(code, ruleId\) \{[\s\S]*?\n  \}\n\n  async function ensureCategory/,
`  async function setDefaultCounterpart(code, ruleId) {
    const tx = (accounting?.transactionCategories || []).find(item => item.code === code);
    const rule = (tx?.rules || []).find(item => item.id === ruleId && item.isActive && item.sourceType === 'fixed_account');
    if (!tx || !rule) return notify('Pilihan akun lawan legacy tidak ditemukan.');
    try {
      await api(\`/api/admin/settings/accounting/journal-rules/\${encodeURIComponent(rule.id)}\`, {
        method: 'PATCH', body: JSON.stringify({ transactionCategoryId: tx.id, isDefault: true })
      });
      await loadData(); render(); notify(\`\${rule.fixedAccount?.code} \${rule.fixedAccount?.name} sekarang menjadi default legacy \${tx.name}.\`);
    } catch (error) { notify(error.message); }
  }

  async function setDefaultChoiceOption(code, optionId) {
    const tx = (accounting?.transactionCategories || []).find(item => item.code === code);
    const choiceRule = (tx?.rules || []).find(item => item.isActive && item.sourceType === 'choice_group');
    const group = (accounting?.choiceGroups || []).find(item => item.id === choiceRule?.choiceGroupId);
    const option = (group?.options || []).find(item => item.id === optionId && item.isActive);
    if (!tx || !option) return notify('Pilihan Setting Transaksi tidak ditemukan.');
    try {
      await api(\`/api/admin/settings/accounting/choice-options/\${encodeURIComponent(option.id)}\`, {
        method: 'PATCH', body: JSON.stringify({ isDefault: true })
      });
      await loadData(); render(); notify(\`\${option.account?.code || ''} \${option.account?.name || option.name} sekarang menjadi default \${tx.name}.\`);
    } catch (error) { notify(error.message); }
  }

  async function ensureCategory`, 'default option handler');

  source = replaceOnce(source,
/  function matchesManagedShape\(activeRules, preset\) \{[\s\S]*?\n  \}\n\n  async function applyPreset/,
`  const cashChoiceGroupCode = code => code === 'cash_flow_out' ? 'CASH_FLOW_OUT_COUNTERPART' : 'CASH_FLOW_IN_COUNTERPART';
  const cashChoiceGroupName = code => code === 'cash_flow_out' ? 'Arus Kas Keluar · Akun Lawan' : 'Arus Kas Masuk · Akun Lawan';

  function matchesManagedShape(activeRules, preset) {
    if (isCashPreset(Object.keys(FLOW_PRESETS).find(code => FLOW_PRESETS[code] === preset))) {
      const payments = activeRules.filter(rule => rule.sourceType === 'payment_method');
      const choices = activeRules.filter(rule => rule.sourceType === 'choice_group');
      const legacy = activeRules.filter(rule => rule.sourceType === 'fixed_account');
      if (payments.length !== 1 || choices.length > 1) return false;
      if (!choices.length && !legacy.length) return false;
      return activeRules.every(rule => ['payment_method', 'choice_group', 'fixed_account'].includes(rule.sourceType));
    }
    if (activeRules.length !== 2) return false;
    return preset.rules.every(expected => activeRules.some(rule =>
      rule.side === expected.side
      && (expected.sourceType === 'fixed_account' ? rule.sourceType === 'fixed_account' : rule.sourceType === expected.sourceType)
    ));
  }

  async function ensureCashChoiceGroup(code) {
    const stableCode = cashChoiceGroupCode(code);
    let group = (accounting?.choiceGroups || []).find(item => item.code === stableCode);
    if (group) return group;
    try {
      const created = await api('/api/admin/settings/accounting/choice-groups', {
        method: 'POST',
        body: JSON.stringify({ code: stableCode, name: cashChoiceGroupName(code), isActive: true })
      });
      accounting = await api('/api/admin/settings/accounting');
      group = (accounting.choiceGroups || []).find(item => item.id === created.id || item.code === stableCode);
      if (!group) throw new Error('Setting Transaksi Arus Kas gagal dimuat setelah dibuat.');
      return group;
    } catch (error) {
      if (error.status !== 409) throw error;
      accounting = await api('/api/admin/settings/accounting');
      group = (accounting.choiceGroups || []).find(item => item.code === stableCode);
      if (!group) throw error;
      return group;
    }
  }

  async function ensureCashChoiceOption(group, account, { isDefault = false, sortOrder = 0 } = {}) {
    accounting = await api('/api/admin/settings/accounting');
    const liveGroup = (accounting.choiceGroups || []).find(item => item.id === group.id) || group;
    const existing = (liveGroup.options || []).find(option => option.accountId === account.id);
    if (existing) {
      if (isDefault && !existing.isDefault) {
        await api(\`/api/admin/settings/accounting/choice-options/\${encodeURIComponent(existing.id)}\`, {
          method: 'PATCH', body: JSON.stringify({ isDefault: true, isActive: true, accountId: account.id })
        });
      }
      return existing;
    }
    try {
      const created = await api('/api/admin/settings/accounting/choice-options', {
        method: 'POST',
        body: JSON.stringify({
          choiceGroupId: group.id,
          code: account.code,
          name: account.name,
          accountId: account.id,
          isDefault,
          sortOrder,
          isActive: true
        })
      });
      return { id: created.id, accountId: account.id, isDefault };
    } catch (error) {
      if (error.status !== 409) throw error;
      accounting = await api('/api/admin/settings/accounting');
      const refreshed = (accounting.choiceGroups || []).find(item => item.id === group.id);
      const found = (refreshed?.options || []).find(option => option.accountId === account.id);
      if (!found) throw error;
      if (isDefault && !found.isDefault) {
        await api(\`/api/admin/settings/accounting/choice-options/\${encodeURIComponent(found.id)}\`, {
          method: 'PATCH', body: JSON.stringify({ isDefault: true })
        });
      }
      return found;
    }
  }

  async function applyPreset`, 'flow preset choice helpers');

  source = replaceOnce(source,
/      if \(isCashPreset\(code\)\) \{[\s\S]*?\n      \} else if \(!activeRules.length\) \{/,
`      if (isCashPreset(code)) {
        const paymentExpected = preset.rules.find(rule => rule.sourceType === 'payment_method');
        let paymentRule = activeRules.find(rule => rule.sourceType === 'payment_method');
        if (!paymentRule) {
          await api('/api/admin/settings/accounting/journal-rules', {
            method: 'POST', body: JSON.stringify({ transactionCategoryId: current?.id || tx.id, ...paymentExpected, isActive: true })
          });
        }

        const choiceExpected = preset.rules.find(rule => rule.sourceType === 'choice_group');
        const group = await ensureCashChoiceGroup(code);
        const legacyRules = activeRules.filter(rule => rule.sourceType === 'fixed_account');
        for (let index = 0; index < legacyRules.length; index += 1) {
          const legacyRule = legacyRules[index];
          const legacyAccount = activeAccounts().find(account => account.id === legacyRule.fixedAccountId);
          if (legacyAccount) {
            await ensureCashChoiceOption(group, legacyAccount, {
              isDefault: Boolean(legacyRule.isDefault),
              sortOrder: 10 + index
            });
          }
        }

        accounting = await api('/api/admin/settings/accounting');
        const refreshedGroup = (accounting.choiceGroups || []).find(item => item.id === group.id) || group;
        const hasDefault = (refreshedGroup.options || []).some(option => option.isActive && option.isDefault);
        const makeDefault = Boolean(el('accFlowMakeDefault')?.checked) || !hasDefault;
        await ensureCashChoiceOption(refreshedGroup, counterpart, {
          isDefault: makeDefault,
          sortOrder: 10 + (refreshedGroup.options || []).length
        });

        accounting = await api('/api/admin/settings/accounting');
        const refreshedTx = (accounting.transactionCategories || []).find(item => item.id === current?.id || item.code === code);
        const choiceRule = (refreshedTx?.rules || []).find(rule => rule.isActive && rule.sourceType === 'choice_group');
        if (!choiceRule) {
          await api('/api/admin/settings/accounting/journal-rules', {
            method: 'POST',
            body: JSON.stringify({
              transactionCategoryId: refreshedTx?.id || current?.id || tx.id,
              label: choiceExpected.label,
              side: choiceExpected.side,
              sourceType: 'choice_group',
              choiceGroupId: group.id,
              sortOrder: choiceExpected.sortOrder,
              isActive: true
            })
          });
        }
        // Legacy fixed_account rules intentionally remain active during the compatibility window.
        // New cashier requests prefer Choice Group; queued old facts can still resolve journalRuleId.
      } else if (!activeRules.length) {`, 'flow preset apply cash');

  writeFileSync(path, source);
}

// 5) Extend tests without deleting legacy compatibility coverage.
{
  const path = 'test/accounting-cash-flow-bridge.test.js';
  let source = readFileSync(path, 'utf8');
  if (!source.includes("choice group Cash Flow becomes canonical while queued legacy journalRuleId remains readable")) {
    source += `\n\ntest('choice group Cash Flow becomes canonical while queued legacy journalRuleId remains readable', async () => {\n  const sqlite = freshDatabase();\n  const db = d1(sqlite);\n  try {\n    const store = sqlite.prepare('SELECT id FROM stores ORDER BY id LIMIT 1').get();\n    const category = sqlite.prepare(\"SELECT id FROM transaction_categories WHERE store_id = ? AND code = 'cash_flow_in'\").get(store.id);\n    const legacyRule = sqlite.prepare(\"SELECT r.id, r.fixed_account_id FROM journal_rules r WHERE r.store_id = ? AND r.transaction_category_id = ? AND r.source_type = 'fixed_account' AND r.side = 'CREDIT' ORDER BY r.is_default DESC, r.id LIMIT 1\").get(store.id, category.id);\n    const account = sqlite.prepare('SELECT id, code, name FROM chart_of_accounts WHERE id = ?').get(legacyRule.fixed_account_id);\n    assert.ok(account?.id);\n\n    sqlite.prepare(\"INSERT INTO accounting_choice_groups (id, store_id, code, name, is_active) VALUES ('choice_cash_in_test', ?, 'CASH_FLOW_IN_COUNTERPART', 'Arus Kas Masuk · Akun Lawan', 1)\").run(store.id);\n    sqlite.prepare(\"INSERT INTO accounting_choice_options (id, choice_group_id, store_id, code, name, account_id, is_default, sort_order, is_active) VALUES ('choice_cash_in_option', 'choice_cash_in_test', ?, ?, ?, ?, 1, 10, 1)\").run(store.id, account.code, account.name, account.id);\n    sqlite.prepare(\"INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, choice_group_id, is_active, sort_order, is_default) VALUES ('choice_cash_in_rule', ?, ?, 'Pilihan akun lawan', 'CREDIT', 'choice_group', NULL, 'choice_cash_in_test', 1, 20, 0)\").run(store.id, category.id);\n\n    const options = await listCashFlowCounterpartOptions(db, store.id);\n    const cashIn = options.filter(option => option.direction === 'IN');\n    assert.equal(cashIn.length, 1);\n    assert.equal(cashIn[0].selectionKind, 'choice_group');\n    assert.equal(cashIn[0].groupCode, 'CASH_FLOW_IN_COUNTERPART');\n    assert.equal(cashIn[0].optionCode, account.code);\n    assert.equal(cashIn[0].accountingReady, true);\n\n    const normalized = await normalizeApprovalPayload(db, store.id, 'CASH_FLOW', {\n      direction: 'IN', amount: 2500, description: 'Choice flow',\n      choiceSelections: [{ groupCode: 'CASH_FLOW_IN_COUNTERPART', optionCode: account.code }]\n    });\n    assert.equal(normalized.ok, true);\n    assert.deepEqual(normalized.payload.choiceSelections, [{ groupCode: 'CASH_FLOW_IN_COUNTERPART', optionCode: account.code }]);\n    assert.equal('accountingCounterpartRuleId' in normalized.payload, false);\n    assert.equal('accountingCounterpartAccountCode' in normalized.payload, false);\n\n    const legacy = await normalizeApprovalPayload(db, store.id, 'CASH_FLOW', {\n      direction: 'IN', amount: 2500, description: 'Queued legacy', accountingCounterpartRuleId: legacyRule.id\n    });\n    assert.equal(legacy.ok, true);\n    assert.equal(legacy.payload.accountingCounterpartRuleId, legacyRule.id);\n\n    const cashier = sqlite.prepare('SELECT id FROM cashiers WHERE store_id = ? ORDER BY id LIMIT 1').get(store.id);\n    sqlite.prepare(\"INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES ('drawer_choice_cash_flow', ?, ?, 0, 'OPEN', '2026-08-20T01:00:00.000Z')\").run(store.id, cashier.id);\n    const requestId = 'approval_choice_cash_flow';\n    const postedAt = '2026-08-20T01:30:00.000Z';\n    sqlite.prepare(\"INSERT INTO approval_requests (id, store_id, drawer_session_id, cashier_id, request_type, payload_json, created_at, updated_at) VALUES (?, ?, 'drawer_choice_cash_flow', ?, 'CASH_FLOW', ?, ?, ?)\").run(requestId, store.id, cashier.id, JSON.stringify(normalized.payload), postedAt, postedAt);\n    sqlite.prepare(\"INSERT INTO cash_ledger_entries (id, store_id, drawer_session_id, approval_request_id, direction, amount, description, note, posted_at, approved_by_role, approved_by_id) VALUES ('cash_choice_ledger', ?, 'drawer_choice_cash_flow', ?, 'IN', 2500, 'Choice flow', '', ?, 'OWNER', 'owner_test')\").run(store.id, requestId, postedAt);\n    sqlite.prepare(\"UPDATE approval_requests SET approval_status = 'approved', posting_status = 'posted', approved_by_role = 'OWNER', approved_by_id = 'owner_test', approved_at = ?, posted_at = ?, updated_at = ? WHERE id = ?\").run(postedAt, postedAt, postedAt, requestId);\n\n    const posted = await dispatchApprovedCashFlowToAccounting(db, store.id, requestId);\n    assert.equal(posted.status, 'POSTED');\n    const provenance = sqlite.prepare(\"SELECT choice_group_code, choice_option_code FROM accounting_journal_lines WHERE journal_id = ? AND choice_group_code <> ''\").get(posted.journalId);\n    assert.equal(provenance.choice_group_code, 'CASH_FLOW_IN_COUNTERPART');\n    assert.equal(provenance.choice_option_code, account.code);\n  } finally { sqlite.close(); }\n});\n`;
  }
  writeFileSync(path, source);
}

{
  const path = 'test/accounting-flow-presets.test.js';
  let source = readFileSync(path, 'utf8');
  source = source
    .replace(/sourceType: 'fixed_account'[\s\S]*?Akun lawan arus kas masuk/g, "sourceType: 'choice_group', label: 'Pilihan akun lawan arus kas masuk")
    .replace(/sourceType: 'fixed_account'[\s\S]*?Akun lawan arus kas keluar/g, "sourceType: 'choice_group', label: 'Pilihan akun lawan arus kas keluar");
  // Static guards added below intentionally coexist with older Goods Flow fixed-account assertions.
  if (!source.includes('Cash Flow preset migrates to canonical Choice Group without deleting legacy compatibility rules')) {
    source += `\n\ntest('Cash Flow preset migrates to canonical Choice Group without deleting legacy compatibility rules', () => {\n  assert.match(script, /CASH_FLOW_IN_COUNTERPART/);\n  assert.match(script, /CASH_FLOW_OUT_COUNTERPART/);\n  assert.match(script, /sourceType: 'choice_group'/);\n  assert.match(script, /choice-options/);\n  assert.match(script, /choiceGroupId/);\n  assert.match(script, /Legacy fixed_account rules intentionally remain active during the compatibility window/);\n  assert.match(script, /data-default-flow-option/);\n});\n`;
  }
  writeFileSync(path, source);
}

{
  const path = 'test/operational-posting.test.js';
  let source = readFileSync(path, 'utf8');
  if (!source.includes('new cash flow approval facts carry neutral Choice Group codes')) {
    source += `\n\ntest('new cash flow approval facts carry neutral Choice Group codes instead of Accounting account authority', () => {\n  assert.match(posting, /choiceSelections/);\n  assert.match(posting, /choiceGroupCode/);\n  assert.match(posting, /choiceOptionCode/);\n  assert.match(cashierUi, /data-group-code/);\n  assert.match(cashierUi, /data-option-code/);\n  assert.doesNotMatch(cashierUi, /payload\\.accountId|payload\\.debit|payload\\.credit/i);\n});\n`;
  }
  writeFileSync(path, source);
}

console.log('Accounting Cash Flow Choice Group transforms applied.');
