-- ===========================================================================
-- Validación de pagos por comprobante (cliente Vanesa Rúas).
--
-- Las profesionales mandan por WhatsApp el comprobante de transferencia de su
-- inscripción. El agente lee la imagen con Claude vision, extrae los datos
-- posibles (quién envía, monto, fecha, N° de operación, banco/medio) y
-- registra una fila acá en estado 'pending'. El equipo de Vane la valida
-- manualmente contra su contabilidad desde el panel y la marca 'validated' o
-- 'rejected' para habilitar (o no) el acceso al curso.
--
-- La imagen del comprobante vive en Supabase Storage (bucket privado
-- `comprobantes`); acá guardamos solo el path. Multi-tenant via client_slug +
-- RLS, igual que el resto de las tablas (ver migration 004).
-- ===========================================================================

-- --- 1. Adjuntos en messages ----------------------------------------------
-- Un mensaje entrante puede traer una imagen (el comprobante). Guardamos el
-- path en Storage y el mime. content sigue siendo el texto/caption (puede ir
-- vacío si la profesional manda solo la foto).
alter table messages add column attachment_path text;
alter table messages add column attachment_type text;

-- --- 2. Tabla payment_validations -----------------------------------------
create table payment_validations (
  id uuid primary key default gen_random_uuid(),

  -- Origen. Si se borra la conversación NO perdemos el registro del pago
  -- (es dato contable): se desvincula (set null) pero la fila persiste.
  conversation_id uuid references conversations(id) on delete set null,
  message_id uuid references messages(id) on delete set null,

  -- Imagen del comprobante (bucket privado `comprobantes`, path namespaceado
  -- por client_slug). Se sirve al panel con signed URLs de vida corta.
  comprobante_path text,
  comprobante_type text,

  -- Datos extraídos por Claude vision (todos opcionales: el OCR puede no
  -- encontrar todo, y el equipo valida igual contra su contabilidad).
  sender_name      text,   -- quién envía el dinero
  sender_tax_id    text,   -- CUIT/CUIL del emisor
  recipient_name   text,   -- destinatario (debería ser la cuenta de Vane)
  recipient_tax_id text,
  amount           numeric(14, 2),
  currency         text default 'ARS',
  transfer_date_raw text,             -- lo que el comprobante muestra, tal cual
  transferred_at   timestamptz,       -- normalizado cuando se puede parsear
  operation_number text,              -- N° de operación / comprobante
  bank_or_method   text,              -- Galicia, Mercado Pago, etc.
  concept          text,              -- concepto / motivo

  -- Salida cruda del extractor (JSON completo + confianza) para auditoría.
  extraction       jsonb,
  extraction_confidence text,         -- 'high' | 'medium' | 'low'

  -- Datos del contacto que mandó el pago (distinto del emisor del comprobante:
  -- a veces paga un familiar). Si la profesional los da, los guardamos.
  contact_name  text,
  contact_email text,

  -- Evento al que aplica el pago. La tabla `events` todavía no existe; por
  -- ahora queda como slug libre y el equipo lo asigna al validar.
  event_slug text,

  -- Validación manual del equipo.
  status text not null default 'pending'
    check (status in ('pending', 'validated', 'rejected')),
  validated_by uuid references profiles(id) on delete set null,
  validated_at timestamptz,
  validation_note text,

  -- Multi-tenant.
  client_slug text not null default current_client_slug(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on payment_validations (client_slug, status, created_at desc);
create index on payment_validations (client_slug, conversation_id);

-- --- 3. RLS (tenant isolation, mismo patrón que migration 004) -------------
alter table payment_validations enable row level security;

create policy tenant_isolation on payment_validations
  for all to anon, authenticated
  using (client_slug = current_client_slug())
  with check (client_slug = current_client_slug());

-- --- 4. Realtime: el panel observa los pagos pendientes en vivo ------------
alter publication supabase_realtime add table payment_validations;

-- --- 5. Bucket privado para los comprobantes -------------------------------
-- Privado: las imágenes solo se sirven via signed URLs generadas server-side.
-- El acceso se hace con el admin client (service_role) desde las API routes y
-- el worker; los paths se namespacean por client_slug
-- (`<client_slug>/<conversation_id>/<uuid>.<ext>`) para aislar por cliente.
insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;
