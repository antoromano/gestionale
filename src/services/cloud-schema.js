// src/services/cloud-schema.js
// GENERATO da scripts/gen-cloud-schema.mjs a partire dallo schema reale di Supabase. Non modificare a mano.
// t = tipo Postgres, n = nullable, d = ha un valore di default, g = colonna generata/non scrivibile.

export const SYNCED_TABLES = ["settings","clients","services_catalog","quotes","quote_items","quote_item_images","quote_extra_services","payments","todos","appointments","finance_transactions","trading_items","brain_memories","brain_nodes","brain_facts","brain_edges","body_exercise_columns","body_daily_logs","body_workout_entries","ai_note_queue"];

export const CLOUD_SCHEMA = {
 "settings": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": false,
   "d": false,
   "g": false
  },
  "app_name": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "logo_url": {
   "t": "text",
   "n": true,
   "d": false,
   "g": false
  },
  "app_icon_url": {
   "t": "text",
   "n": true,
   "d": false,
   "g": false
  },
  "primary_color": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "accent_color": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "business_name": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "owner_name": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "address": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "city": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "postal_code": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "vat_number": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "fiscal_code": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "email": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "phone": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "pec": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "sdi_code": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "currency": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "currency_symbol": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "language": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "timezone": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "date_format": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "quote_default_validity_days": {
   "t": "int4",
   "n": true,
   "d": true,
   "g": false
  },
  "quote_default_conditions": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "fiscal_levy_name": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "fiscal_levy_percent": {
   "t": "numeric",
   "n": true,
   "d": true,
   "g": false
  },
  "fiscal_levy_enabled": {
   "t": "bool",
   "n": true,
   "d": true,
   "g": false
  },
  "vat_percent": {
   "t": "numeric",
   "n": true,
   "d": true,
   "g": false
  },
  "vat_enabled": {
   "t": "bool",
   "n": true,
   "d": true,
   "g": false
  },
  "google_calendar_connected": {
   "t": "bool",
   "n": true,
   "d": true,
   "g": false
  },
  "google_calendar_id": {
   "t": "text",
   "n": true,
   "d": false,
   "g": false
  },
  "google_sync_last_at": {
   "t": "timestamptz",
   "n": true,
   "d": false,
   "g": false
  },
  "notion_connected": {
   "t": "bool",
   "n": true,
   "d": true,
   "g": false
  },
  "notion_database_id": {
   "t": "text",
   "n": true,
   "d": false,
   "g": false
  },
  "notion_sync_last_at": {
   "t": "timestamptz",
   "n": true,
   "d": false,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "clients": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": false,
   "d": false,
   "g": false
  },
  "type": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "first_name": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "last_name": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "company_name": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "contact_person": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "email": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "phone": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "address": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "postal_code": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "city": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "vat_number": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "fiscal_code": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "pec": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "sdi_code": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "tags": {
   "t": "text[]",
   "n": true,
   "d": true,
   "g": false
  },
  "origin": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "notes": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "is_deleted": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "deleted_at": {
   "t": "timestamptz",
   "n": true,
   "d": false,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "services_catalog": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": false,
   "d": false,
   "g": false
  },
  "name": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "category": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "price": {
   "t": "numeric",
   "n": false,
   "d": true,
   "g": false
  },
  "unit": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "description": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "details": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "is_deleted": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "quotes": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": false,
   "d": false,
   "g": false
  },
  "quote_number": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "title": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "issue_date": {
   "t": "date",
   "n": false,
   "d": true,
   "g": false
  },
  "valid_until": {
   "t": "date",
   "n": true,
   "d": false,
   "g": false
  },
  "client_id": {
   "t": "uuid",
   "n": true,
   "d": false,
   "g": false
  },
  "recipient_manual": {
   "t": "jsonb",
   "n": true,
   "d": true,
   "g": false
  },
  "status": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "internal_notes": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "work_status": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "expected_delivery": {
   "t": "date",
   "n": true,
   "d": false,
   "g": false
  },
  "show_total_in_pdf": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "global_discount_percent": {
   "t": "numeric",
   "n": true,
   "d": true,
   "g": false
  },
  "agreed_total": {
   "t": "numeric",
   "n": true,
   "d": false,
   "g": false
  },
  "fiscal_levy_enabled": {
   "t": "bool",
   "n": true,
   "d": true,
   "g": false
  },
  "fiscal_levy_name": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "fiscal_levy_percent": {
   "t": "numeric",
   "n": true,
   "d": true,
   "g": false
  },
  "vat_enabled": {
   "t": "bool",
   "n": true,
   "d": true,
   "g": false
  },
  "vat_percent": {
   "t": "numeric",
   "n": true,
   "d": true,
   "g": false
  },
  "conditions": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "is_deleted": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "deleted_at": {
   "t": "timestamptz",
   "n": true,
   "d": false,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "quote_items": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "quote_id": {
   "t": "uuid",
   "n": false,
   "d": false,
   "g": false
  },
  "position": {
   "t": "int4",
   "n": false,
   "d": true,
   "g": false
  },
  "description": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "quantity": {
   "t": "numeric",
   "n": false,
   "d": true,
   "g": false
  },
  "unit": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "unit_price": {
   "t": "numeric",
   "n": false,
   "d": true,
   "g": false
  },
  "discount_percent": {
   "t": "numeric",
   "n": false,
   "d": true,
   "g": false
  },
  "is_freebie": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "visible_details": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "internal_notes": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "quote_item_images": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "quote_item_id": {
   "t": "uuid",
   "n": false,
   "d": false,
   "g": false
  },
  "storage_path": {
   "t": "text",
   "n": true,
   "d": false,
   "g": false
  },
  "file_url": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "caption": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "file_name": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "file_size": {
   "t": "int4",
   "n": true,
   "d": true,
   "g": false
  },
  "position": {
   "t": "int4",
   "n": false,
   "d": true,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "quote_extra_services": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "quote_id": {
   "t": "uuid",
   "n": false,
   "d": false,
   "g": false
  },
  "description": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "amount": {
   "t": "numeric",
   "n": false,
   "d": true,
   "g": false
  },
  "status": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "proposed_at": {
   "t": "date",
   "n": true,
   "d": true,
   "g": false
  },
  "approved_at": {
   "t": "date",
   "n": true,
   "d": false,
   "g": false
  },
  "notes": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "payments": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": false,
   "d": false,
   "g": false
  },
  "quote_id": {
   "t": "uuid",
   "n": true,
   "d": false,
   "g": false
  },
  "client_id": {
   "t": "uuid",
   "n": true,
   "d": false,
   "g": false
  },
  "type": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "amount": {
   "t": "numeric",
   "n": false,
   "d": true,
   "g": false
  },
  "status": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "due_date": {
   "t": "date",
   "n": true,
   "d": false,
   "g": false
  },
  "payment_date": {
   "t": "date",
   "n": true,
   "d": false,
   "g": false
  },
  "method": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "reference_number": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "notes": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "is_deleted": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "deleted_at": {
   "t": "timestamptz",
   "n": true,
   "d": false,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "todos": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": false,
   "d": false,
   "g": false
  },
  "title": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "notes": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "client_id": {
   "t": "uuid",
   "n": true,
   "d": false,
   "g": false
  },
  "quote_id": {
   "t": "uuid",
   "n": true,
   "d": false,
   "g": false
  },
  "compensation_mode": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "compensation_amount": {
   "t": "numeric",
   "n": true,
   "d": true,
   "g": false
  },
  "deposit_received": {
   "t": "numeric",
   "n": true,
   "d": true,
   "g": false
  },
  "balance_received": {
   "t": "numeric",
   "n": true,
   "d": true,
   "g": false
  },
  "due_date": {
   "t": "timestamptz",
   "n": true,
   "d": false,
   "g": false
  },
  "priority": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "is_completed": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "completed_at": {
   "t": "timestamptz",
   "n": true,
   "d": false,
   "g": false
  },
  "source": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "notion_page_id": {
   "t": "text",
   "n": true,
   "d": false,
   "g": false
  },
  "is_deleted": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "deleted_at": {
   "t": "timestamptz",
   "n": true,
   "d": false,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "appointments": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": false,
   "d": false,
   "g": false
  },
  "title": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "description": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "location": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "client_id": {
   "t": "uuid",
   "n": true,
   "d": false,
   "g": false
  },
  "start_time": {
   "t": "timestamptz",
   "n": false,
   "d": false,
   "g": false
  },
  "end_time": {
   "t": "timestamptz",
   "n": true,
   "d": false,
   "g": false
  },
  "is_all_day": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "timezone": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "compensation_amount": {
   "t": "numeric",
   "n": true,
   "d": true,
   "g": false
  },
  "is_shooting": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "shooting_type": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "google_event_id": {
   "t": "text",
   "n": true,
   "d": false,
   "g": false
  },
  "google_etag": {
   "t": "text",
   "n": true,
   "d": false,
   "g": false
  },
  "google_sync_status": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "is_deleted": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "deleted_at": {
   "t": "timestamptz",
   "n": true,
   "d": false,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "finance_transactions": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": true,
   "d": true,
   "g": false
  },
  "date": {
   "t": "date",
   "n": false,
   "d": true,
   "g": false
  },
  "type": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "category": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "amount": {
   "t": "numeric",
   "n": false,
   "d": false,
   "g": false
  },
  "description": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "payment_method": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "client_id": {
   "t": "uuid",
   "n": true,
   "d": false,
   "g": false
  },
  "quote_id": {
   "t": "uuid",
   "n": true,
   "d": false,
   "g": false
  },
  "is_recurring": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "recurrence_frequency": {
   "t": "text",
   "n": true,
   "d": false,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "notes": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "recurrence_start_date": {
   "t": "date",
   "n": true,
   "d": false,
   "g": false
  },
  "recurrence_end_date": {
   "t": "date",
   "n": true,
   "d": false,
   "g": false
  },
  "is_suspended": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "recurrence_parent_id": {
   "t": "uuid",
   "n": true,
   "d": false,
   "g": false
  },
  "is_deleted": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "deleted_at": {
   "t": "timestamptz",
   "n": true,
   "d": false,
   "g": false
  }
 },
 "trading_items": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": true,
   "d": true,
   "g": false
  },
  "title": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "platform": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "purchase_date": {
   "t": "date",
   "n": false,
   "d": true,
   "g": false
  },
  "purchase_price": {
   "t": "numeric",
   "n": false,
   "d": false,
   "g": false
  },
  "extra_costs": {
   "t": "numeric",
   "n": false,
   "d": true,
   "g": false
  },
  "sale_date": {
   "t": "date",
   "n": true,
   "d": false,
   "g": false
  },
  "sale_price": {
   "t": "numeric",
   "n": true,
   "d": false,
   "g": false
  },
  "platform_fees": {
   "t": "numeric",
   "n": false,
   "d": true,
   "g": false
  },
  "net_profit": {
   "t": "numeric",
   "n": true,
   "d": true,
   "g": true
  },
  "roi_percent": {
   "t": "numeric",
   "n": true,
   "d": true,
   "g": true
  },
  "status": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "notes": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "hours_spent": {
   "t": "numeric",
   "n": true,
   "d": false,
   "g": false
  },
  "is_deleted": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "deleted_at": {
   "t": "timestamptz",
   "n": true,
   "d": false,
   "g": false
  }
 },
 "brain_memories": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": true,
   "d": true,
   "g": false
  },
  "title": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "content": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "summary": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "domain": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "source_type": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "source_id": {
   "t": "text",
   "n": true,
   "d": false,
   "g": false
  },
  "tags": {
   "t": "text[]",
   "n": true,
   "d": true,
   "g": false
  },
  "embedding": {
   "t": "vector",
   "n": true,
   "d": false,
   "g": false
  },
  "is_deleted": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "brain_nodes": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": true,
   "d": true,
   "g": false
  },
  "label": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "node_type": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "properties": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "brain_facts": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": true,
   "d": true,
   "g": false
  },
  "subject": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "fact_key": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "fact_value": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "category": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "confidence": {
   "t": "numeric",
   "n": false,
   "d": true,
   "g": false
  },
  "is_active": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "superseded_by": {
   "t": "uuid",
   "n": true,
   "d": false,
   "g": false
  },
  "valid_from": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "valid_to": {
   "t": "timestamptz",
   "n": true,
   "d": false,
   "g": false
  },
  "source_memory_id": {
   "t": "uuid",
   "n": true,
   "d": false,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "brain_edges": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": true,
   "d": true,
   "g": false
  },
  "source_node_id": {
   "t": "uuid",
   "n": false,
   "d": false,
   "g": false
  },
  "target_node_id": {
   "t": "uuid",
   "n": false,
   "d": false,
   "g": false
  },
  "relation_type": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "weight": {
   "t": "numeric",
   "n": false,
   "d": true,
   "g": false
  },
  "evidence": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "body_exercise_columns": {
  "id": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": true,
   "d": true,
   "g": false
  },
  "name": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "slug": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "category": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "target_frequency_days": {
   "t": "int4",
   "n": false,
   "d": true,
   "g": false
  },
  "available_variants": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  },
  "position": {
   "t": "int4",
   "n": false,
   "d": true,
   "g": false
  },
  "is_active": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "body_daily_logs": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": true,
   "d": true,
   "g": false
  },
  "date": {
   "t": "date",
   "n": false,
   "d": false,
   "g": false
  },
  "sleep_hours": {
   "t": "numeric",
   "n": true,
   "d": false,
   "g": false
  },
  "sleep_quality": {
   "t": "int4",
   "n": true,
   "d": false,
   "g": false
  },
  "body_weight_kg": {
   "t": "numeric",
   "n": true,
   "d": false,
   "g": false
  },
  "calories_kcal": {
   "t": "int4",
   "n": true,
   "d": false,
   "g": false
  },
  "protein_g": {
   "t": "int4",
   "n": true,
   "d": false,
   "g": false
  },
  "carbs_g": {
   "t": "int4",
   "n": true,
   "d": false,
   "g": false
  },
  "fat_g": {
   "t": "int4",
   "n": true,
   "d": false,
   "g": false
  },
  "energy_level": {
   "t": "int4",
   "n": true,
   "d": false,
   "g": false
  },
  "is_rest_day": {
   "t": "bool",
   "n": false,
   "d": true,
   "g": false
  },
  "general_notes": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "body_workout_entries": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": true,
   "d": true,
   "g": false
  },
  "daily_log_id": {
   "t": "uuid",
   "n": true,
   "d": false,
   "g": false
  },
  "date": {
   "t": "date",
   "n": false,
   "d": false,
   "g": false
  },
  "column_id": {
   "t": "text",
   "n": true,
   "d": false,
   "g": false
  },
  "raw_notation": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "parsed_blocks": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  },
  "rpe": {
   "t": "numeric",
   "n": true,
   "d": false,
   "g": false
  },
  "rest_seconds": {
   "t": "int4",
   "n": true,
   "d": false,
   "g": false
  },
  "feeling": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "detailed_notes": {
   "t": "text",
   "n": true,
   "d": true,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  }
 },
 "ai_note_queue": {
  "id": {
   "t": "uuid",
   "n": false,
   "d": true,
   "g": false
  },
  "user_id": {
   "t": "uuid",
   "n": true,
   "d": true,
   "g": false
  },
  "content": {
   "t": "text",
   "n": false,
   "d": false,
   "g": false
  },
  "source": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "status": {
   "t": "text",
   "n": false,
   "d": true,
   "g": false
  },
  "created_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "extra": {
   "t": "jsonb",
   "n": false,
   "d": true,
   "g": false
  },
  "updated_at": {
   "t": "timestamptz",
   "n": false,
   "d": true,
   "g": false
  },
  "processed_at": {
   "t": "timestamptz",
   "n": true,
   "d": false,
   "g": false
  }
 }
};
