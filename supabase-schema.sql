-- ============================================================
--  Gestión de Flota · Esquema inicial para Supabase
--  Copia TODO este contenido y pégalo en:
--  Supabase → tu proyecto → SQL Editor → New query → Run
-- ============================================================

-- Tabla que guarda el estado de la app (equipos, clientes, configuración)
-- como un documento JSON. Suficiente para esta etapa; los módulos de
-- operación (checklists, portería) usarán tablas propias más adelante.
create table if not exists public.flota_state (
  id          text primary key default 'main',
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Seguridad a nivel de fila: nadie accede sin iniciar sesión.
alter table public.flota_state enable row level security;

-- Solo usuarios autenticados pueden leer.
drop policy if exists "auth_read" on public.flota_state;
create policy "auth_read" on public.flota_state
  for select using (auth.role() = 'authenticated');

-- Solo usuarios autenticados pueden crear.
drop policy if exists "auth_insert" on public.flota_state;
create policy "auth_insert" on public.flota_state
  for insert with check (auth.role() = 'authenticated');

-- Solo usuarios autenticados pueden actualizar.
drop policy if exists "auth_update" on public.flota_state;
create policy "auth_update" on public.flota_state
  for update using (auth.role() = 'authenticated');

-- Fila única inicial.
insert into public.flota_state (id, data)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;
