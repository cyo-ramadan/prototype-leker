// Canonical capability descriptors, initialized from the U0 fixture. No model-supplied handlers.
import { menuUntuk } from './caca-peta.js';
import { validateAction, validateSchema, relevantCapability } from './una-kemampuan-validasi.js';
import { validateCanvasOperation } from './una-kanvas-patch.js';
const deepFreeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; };
export const UNA_KEMAMPUAN = deepFreeze({
  "formatVersion": 1,
  "categories": [
    "navigation",
    "read",
    "view",
    "artifact",
    "business_draft"
  ],
  "effects": [
    "none",
    "view",
    "artifact",
    "draft"
  ],
  "proofs": [
    "none",
    "state_read",
    "data_loaded",
    "artifact_saved",
    "draft_created"
  ],
  "preconditions": [
    "surface_active",
    "page_mounted",
    "scope_entity",
    "scope_store",
    "canvas_saved"
  ],
  "roles": [
    "ENTITY_ADMIN",
    "OWNER",
    "ADMIN",
    "CASHIER"
  ],
  "capabilities": [
    {
      "id": "page.open",
      "version": 1,
      "label": "Buka layar",
      "aliases": [
        "buka halaman",
        "buka layar",
        "ke halaman",
        "pindah ke"
      ],
      "category": "navigation",
      "effect": "view",
      "page": null,
      "surfaceKind": "page",
      "roles": [
        "ENTITY_ADMIN",
        "OWNER",
        "ADMIN",
        "CASHIER"
      ],
      "scopes": [
        "entity",
        "gerai"
      ],
      "preconditions": [],
      "params": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "halaman",
          "tab"
        ],
        "properties": {
          "halaman": {
            "type": "string",
            "maxLength": 10,
            "enum": [
              "entity",
              "gerai"
            ]
          },
          "tab": {
            "type": "string",
            "maxLength": 40,
            "pattern": "^[\\w-]{1,40}$"
          },
          "display": {
            "type": "string",
            "maxLength": 10,
            "enum": [
              "workspace",
              "menu"
            ],
            "default": "workspace"
          }
        }
      },
      "proof": "state_read",
      "modelVisible": true
    },
    {
      "id": "page.read_state",
      "version": 1,
      "label": "Baca keadaan layar",
      "aliases": [
        "lagi buka apa",
        "filter sekarang apa"
      ],
      "category": "read",
      "effect": "none",
      "page": null,
      "surfaceKind": "page",
      "roles": [
        "ENTITY_ADMIN",
        "OWNER",
        "ADMIN",
        "CASHIER"
      ],
      "scopes": [
        "entity",
        "gerai"
      ],
      "preconditions": [
        "surface_active",
        "page_mounted"
      ],
      "params": {
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "proof": "state_read",
      "modelVisible": true
    },
    {
      "id": "report.set_filters",
      "version": 1,
      "label": "Ubah filter laporan",
      "aliases": [
        "ganti tanggal laporan",
        "ubah periode",
        "ganti range tanggal",
        "pilih gerai laporan"
      ],
      "category": "view",
      "effect": "view",
      "page": {
        "halaman": "entity",
        "tab": "reports"
      },
      "surfaceKind": "page",
      "roles": [
        "ENTITY_ADMIN",
        "OWNER"
      ],
      "scopes": [
        "entity"
      ],
      "preconditions": [
        "page_mounted",
        "scope_entity"
      ],
      "params": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "from",
          "to"
        ],
        "properties": {
          "from": {
            "type": "string",
            "maxLength": 10,
            "format": "date"
          },
          "to": {
            "type": "string",
            "maxLength": 10,
            "format": "date"
          },
          "stores": {
            "type": "array",
            "maxItems": 100,
            "items": {
              "type": "string",
              "maxLength": 20,
              "pattern": "^[A-Za-z0-9_-]{1,20}$"
            }
          },
          "reload": {
            "type": "boolean",
            "default": true
          }
        }
      },
      "proof": "data_loaded",
      "modelVisible": true
    },
    {
      "id": "report.refresh",
      "version": 1,
      "label": "Muat ulang laporan",
      "aliases": [
        "tampilkan laporan",
        "refresh laporan",
        "muat ulang laporan"
      ],
      "category": "view",
      "effect": "view",
      "page": {
        "halaman": "entity",
        "tab": "reports"
      },
      "surfaceKind": "page",
      "roles": [
        "ENTITY_ADMIN",
        "OWNER"
      ],
      "scopes": [
        "entity"
      ],
      "preconditions": [
        "page_mounted",
        "scope_entity"
      ],
      "params": {
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "proof": "data_loaded",
      "modelVisible": true
    },
    {
      "id": "surface.focus",
      "version": 1,
      "label": "Pindah lembar",
      "aliases": [
        "pindah ke lembar",
        "buka lagi lembar"
      ],
      "category": "navigation",
      "effect": "view",
      "page": null,
      "surfaceKind": null,
      "roles": [
        "ENTITY_ADMIN",
        "OWNER",
        "ADMIN",
        "CASHIER"
      ],
      "scopes": [
        "entity",
        "gerai"
      ],
      "preconditions": [],
      "params": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "surfaceId"
        ],
        "properties": {
          "surfaceId": {
            "type": "string",
            "maxLength": 60,
            "pattern": "^(srf_[0-9a-f-]{36}|task:[\\w-]{1,60})$"
          }
        }
      },
      "proof": "state_read",
      "modelVisible": true
    },
    {
      "id": "surface.close",
      "version": 1,
      "label": "Tutup tampilan lembar",
      "aliases": [
        "tutup lembar",
        "tutup layar ini"
      ],
      "category": "navigation",
      "effect": "view",
      "page": null,
      "surfaceKind": null,
      "roles": [
        "ENTITY_ADMIN",
        "OWNER",
        "ADMIN",
        "CASHIER"
      ],
      "scopes": [
        "entity",
        "gerai"
      ],
      "preconditions": [
        "surface_active"
      ],
      "params": {
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {}
      },
      "proof": "none",
      "modelVisible": true
    },
    {
      "id": "task.open",
      "version": 1,
      "label": "Buka tugas Workspace",
      "aliases": [
        "buka draft",
        "lihat tugas"
      ],
      "category": "navigation",
      "effect": "view",
      "page": null,
      "surfaceKind": "task",
      "roles": [
        "ENTITY_ADMIN",
        "OWNER",
        "ADMIN",
        "CASHIER"
      ],
      "scopes": [
        "entity",
        "gerai"
      ],
      "preconditions": [],
      "params": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "taskId"
        ],
        "properties": {
          "taskId": {
            "type": "string",
            "maxLength": 60,
            "pattern": "^[\\w-]{1,60}$"
          }
        }
      },
      "proof": "state_read",
      "modelVisible": true
    },
    {
      "id": "canvas.create",
      "version": 1,
      "label": "Buka lembar gambar",
      "aliases": [
        "buka lembar gambar",
        "buat kanvas",
        "lembar coret"
      ],
      "category": "artifact",
      "effect": "artifact",
      "page": null,
      "surfaceKind": "canvas",
      "roles": [
        "ENTITY_ADMIN",
        "OWNER",
        "ADMIN",
        "CASHIER"
      ],
      "scopes": [
        "entity",
        "gerai"
      ],
      "preconditions": [],
      "params": {
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "title": {
            "type": "string",
            "maxLength": 80
          },
          "background": {
            "type": "string",
            "maxLength": 10,
            "enum": [
              "white",
              "grid"
            ],
            "default": "white"
          }
        }
      },
      "proof": "artifact_saved",
      "modelVisible": true
    },
    {
      "id": "canvas.read",
      "version": 1,
      "label": "Baca lembar gambar",
      "aliases": [
        "lihat gambar ini",
        "baca coretan",
        "ini maksudnya apa"
      ],
      "category": "read",
      "effect": "none",
      "page": null,
      "surfaceKind": "canvas",
      "roles": [
        "ENTITY_ADMIN",
        "OWNER",
        "ADMIN",
        "CASHIER"
      ],
      "scopes": [
        "entity",
        "gerai"
      ],
      "preconditions": [
        "surface_active",
        "canvas_saved"
      ],
      "params": {
        "type": "object",
        "additionalProperties": false,
        "required": [],
        "properties": {
          "objectIds": {
            "type": "array",
            "maxItems": 200,
            "items": {
              "type": "string",
              "maxLength": 40,
              "pattern": "^[\\w-]{1,40}$"
            }
          }
        }
      },
      "proof": "state_read",
      "modelVisible": true
    },
    {
      "id": "canvas.apply_patch",
      "version": 1,
      "label": "Ubah isi lembar gambar",
      "aliases": [
        "tambah tulisan di gambar",
        "rapikan gambar"
      ],
      "category": "artifact",
      "effect": "artifact",
      "page": null,
      "surfaceKind": "canvas",
      "roles": [
        "ENTITY_ADMIN",
        "OWNER",
        "ADMIN",
        "CASHIER"
      ],
      "scopes": [
        "entity",
        "gerai"
      ],
      "preconditions": [
        "surface_active",
        "canvas_saved"
      ],
      "params": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "operations"
        ],
        "properties": {
          "operations": {
            "type": "array",
            "maxItems": 50,
            "items": {
              "type": "object",
              "ref": "canvas.operation"
            }
          }
        }
      },
      "proof": "artifact_saved",
      "modelVisible": true
    }
  ]
});
export const KEMAMPUAN = UNA_KEMAMPUAN.capabilities;
for (const descriptor of KEMAMPUAN) validateSchema(descriptor.params);
export const cariKemampuan = id => KEMAMPUAN.find(c => c.id === id) || null;
export function validasiPerintah(command,context,options={}) {
  return validateAction(command,context,KEMAMPUAN,{...options,refs:{'canvas.operation':validateCanvasOperation,...options.refs},menuUntuk});
}
export function daftarKemampuanUntukModel(context) {
  const role = String(context.role || context.peran || '').toUpperCase().replace(/[ -]/g,'_');
  return KEMAMPUAN.filter(c => c.modelVisible && c.roles.includes(role) && c.scopes.includes(context.lingkup) && relevantCapability(c,context)
    && (!c.page || menuUntuk({skin:context.skin || 'classic',peran:role,halaman:c.page.halaman}).some(m=>m.tab===c.page.tab)))
    .map(c=>({id:c.id,version:c.version,label:c.label,aliases:c.aliases,params:c.params}));
}
export function buatAksiBuka(navigasi,context={}) {
  const uuid = () => globalThis.crypto.randomUUID();
  const command = {actionId:'act_'+uuid(),turnId:context.surfaceContext?.turnId || 'turn_'+uuid(),
    capabilityId:'page.open',capabilityVersion:1,
    params:{halaman:navigasi.halaman,tab:navigasi.tab,display:'workspace'},
    target:null,scopeEpoch:context.surfaceContext?.scopeEpoch ?? 0,origin:'code'};
  const checked = validasiPerintah(command,{role:context.peran,lingkup:context.lingkup,skin:context.skin,scopeEpoch:command.scopeEpoch});
  return checked.ok ? [checked.command] : [];
}
