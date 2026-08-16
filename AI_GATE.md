# Prototype Leker AI Gate

Status: ACTIVE
Authority: Bos Cyo
Repository: `cyo-ramadan/prototype-leker`

This file is the local entrypoint for any AI or developer working in Prototype Leker. It does not replace the MAXI protocol or domain contracts.

## 1. Mandatory protocol

Before editing, read the active documents in `cyo-ramadan/maxi-protocol`:

1. `quick-gate/MAXI_AI_QUICK_GATE.md`
2. `constitution/MAXI_ENGINEERING_CONSTITUTION.md`
3. `manuals/MAXI_AI_ONBOARDING.md` when full onboarding is required
4. `standards/PROTOTYPE_ENVIRONMENT_AND_DEPLOYMENT.md` for deployment or Cloudflare/D1 work

Then read this repository's `MODULE_MANIFEST.md` and the task-relevant local sources.

## 2. Local source-of-truth routing

- Project/module identity and integration map: `MODULE_MANIFEST.md`
- Current active capability and limitation: `README.md` plus active sections of `KNOWN_ISSUES.md`
- Repeatable traps: `KNOWN_PITFALLS.md`
- Operational deployment/recovery: `RUNBOOK.md`
- Public/domain contracts: `contracts/`
- Architecture rationale: `adr/`
- Implementation: `src/`, `public/`, `migrations/`
- Compatibility evidence: `test/`

If these sources materially conflict, do not choose silently. Show the conflict and resolve it under Bos Cyo's authority before relying on the disputed behavior.

## 3. Hard boundaries

- Business applications report business facts. Accounting owns journal interpretation and posting.
- Inventory/Costing owns stock and valuation interpretation.
- Programs communicate through approved APIs, events, SDKs, and documented bridges. Direct cross-program database writes are prohibited.
- Setting Akuntansi owns mapping/configuration. It does not own account creation or journal posting.
- PIMASATU is a UI/UX interaction pattern only. It owns no business module, persistence, supplier/customer/contact, payment method, Accounting, or journal semantics.
- Do not invent payment methods, account mappings, item mappings, transaction rules, fallback accounts, tax, units, or business behavior.
- Posted journals and official stock movements are corrected through approved reversal/adjustment flows.

## 4. Prototype environment

Canonical prototype environment:

- GitHub: `cyo-ramadan/prototype-leker`
- Production branch: `main`
- Cloudflare account: `Daily Napkin`
- Worker: `prototype-leker-v2`
- D1: `prototype-leker-db`
- D1 binding: `DB`
- Permanent URL: `https://prototype-leker-v2.daily-napkin.workers.dev`

`Dwicahya` is reserved for official/production programs and must not be used by this prototype unless Bos Cyo explicitly reclassifies the program.

## 5. Change and completion gate

Before coding, record scope, affected modules/APIs/events/database objects, contract impact, documentation impact, migration/recovery, compatibility, tests, and material ambiguities.

Make the smallest focused change and preserve unrelated work. Re-read live code/state after concurrent changes.

Every change declares `DOC-IMPACT: REQUIRED` or `DOC-IMPACT: NOT_REQUIRED` with an objective reason.

Do not report PASS while a required test fails, contract/code disagree materially, compatibility is unknown, required migration/recovery evidence is missing, or a material ambiguity remains.

Production data mutation requires explicit Bos Cyo task authority. When authority is present, keep the mutation scoped, auditable, and reversible/reconcilable according to the owning domain.
