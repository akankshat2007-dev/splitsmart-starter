begin;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  code char(4) not null unique check (code::text ~ '^[0-9]{4}$'),
  creator_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  role text not null default 'member' check (role in ('creator', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_join_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0)
);

alter table public.expenses
  add column if not exists group_id uuid references public.groups(id) on delete set null,
  add column if not exists paid_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists expense_date date;

update public.expenses
set expense_date = created_at::date
where expense_date is null;

alter table public.expenses
  alter column expense_date set default current_date;

create table if not exists public.expense_shares (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  primary key (expense_id, user_id)
);

create index if not exists groups_creator_id_idx on public.groups(creator_id);
create index if not exists group_members_user_id_idx on public.group_members(user_id);
create index if not exists expenses_group_id_created_at_idx on public.expenses(group_id, created_at desc) where group_id is not null;
create index if not exists expense_shares_user_id_idx on public.expense_shares(user_id);

create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
set row_security = off
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.role in ('creator', 'admin')
  );
$$;

revoke all on function public.is_group_member(uuid) from public, anon;
revoke all on function public.is_group_admin(uuid) from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.is_group_admin(uuid) to authenticated;

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_join_attempts enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;

revoke all on public.groups, public.group_members, public.group_join_attempts, public.expense_shares, public.expenses from anon;
grant select on public.groups, public.group_members to authenticated;
revoke update on public.groups from authenticated;
grant update (name) on public.groups to authenticated;
grant select on public.expense_shares to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;

 drop policy if exists "group members can read groups" on public.groups;
create policy "group members can read groups" on public.groups
  for select to authenticated using (public.is_group_member(id));

drop policy if exists "group admins can update groups" on public.groups;
create policy "group admins can update groups" on public.groups
  for update to authenticated using (public.is_group_admin(id))
  with check (public.is_group_admin(id));

drop policy if exists "members can read group membership" on public.group_members;
create policy "members can read group membership" on public.group_members
  for select to authenticated using (public.is_group_member(group_id));

drop policy if exists "members can read expense shares" on public.expense_shares;
create policy "members can read expense shares" on public.expense_shares
  for select to authenticated using (
    exists (
      select 1 from public.expenses e
      where e.id = expense_shares.expense_id
        and e.group_id is not null
        and public.is_group_member(e.group_id)
    )
  );

-- Restrictive guards intersect with any pre-existing permissive expense policies.
drop policy if exists "authenticated expense scope guard" on public.expenses;
create policy "authenticated expense scope guard" on public.expenses
  as restrictive for all to authenticated
  using (
    auth.uid() is not null and (
      (group_id is null and user_id = auth.uid())
      or (group_id is not null and public.is_group_member(group_id))
    )
  )
  with check (
    auth.uid() is not null and (
      (group_id is null and user_id = auth.uid())
      or (group_id is not null and public.is_group_member(group_id) and (user_id = auth.uid() or public.is_group_admin(group_id)))
    )
  );

drop policy if exists "authorized expense update guard" on public.expenses;
create policy "authorized expense update guard" on public.expenses
  as restrictive for update to authenticated
  using (group_id is null and user_id = auth.uid())
  with check (group_id is null and user_id = auth.uid());

drop policy if exists "authorized expense delete guard" on public.expenses;
create policy "authorized expense delete guard" on public.expenses
  as restrictive for delete to authenticated
  using (
    (group_id is null and user_id = auth.uid())
    or (group_id is not null and public.is_group_member(group_id) and (user_id = auth.uid() or public.is_group_admin(group_id)))
  );

drop policy if exists "client inserts are personal only" on public.expenses;
create policy "client inserts are personal only" on public.expenses
  as restrictive for insert to authenticated
  with check (group_id is null and user_id = auth.uid());

drop policy if exists "users read personal and member expenses" on public.expenses;
create policy "users read personal and member expenses" on public.expenses
  for select to authenticated using (
    (group_id is null and user_id = auth.uid())
    or (group_id is not null and public.is_group_member(group_id))
  );

drop policy if exists "users create personal expenses" on public.expenses;
create policy "users create personal expenses" on public.expenses
  for insert to authenticated with check (group_id is null and user_id = auth.uid());

drop policy if exists "authors can update expenses" on public.expenses;
create policy "authors can update expenses" on public.expenses
  for update to authenticated using (
    (group_id is null and user_id = auth.uid())
    or (group_id is not null and public.is_group_member(group_id) and user_id = auth.uid())
  ) with check (
    (group_id is null and user_id = auth.uid())
    or (group_id is not null and public.is_group_member(group_id) and user_id = auth.uid())
  );

drop policy if exists "authors and admins delete expenses" on public.expenses;
create policy "authors and admins delete expenses" on public.expenses
  for delete to authenticated using (
    (group_id is null and user_id = auth.uid())
    or (group_id is not null and public.is_group_member(group_id) and (user_id = auth.uid() or public.is_group_admin(group_id)))
  );

create or replace function public.create_group(p_name text)
returns public.groups
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text := coalesce(nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''), nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''), 'Member');
  v_group public.groups;
  v_code text;
  v_attempt integer;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 80 then
    raise exception 'Group name must be between 2 and 80 characters' using errcode = '22023';
  end if;

  for v_attempt in 1..20 loop
    v_code := lpad(floor(random() * 10000)::integer::text, 4, '0');
    insert into public.groups(name, code, creator_id)
    values (btrim(p_name), v_code, v_user_id)
    on conflict (code) do nothing
    returning * into v_group;
    if v_group.id is not null then exit; end if;
  end loop;
  if v_group.id is null then raise exception 'Could not allocate a group code. Please retry.' using errcode = '23505'; end if;

  insert into public.group_members(group_id, user_id, display_name, role)
  values (v_group.id, v_user_id, v_display_name, 'creator');
  return v_group;
end;
$$;

create or replace function public.join_group_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_group public.groups;
  v_display_name text := coalesce(nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''), nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''), 'Member');
  v_attempts integer;
  v_joined_group_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_code is null or p_code !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_code', 'message', 'Enter a valid four-digit code.');
  end if;

  insert into public.group_join_attempts(user_id, window_started_at, attempt_count)
  values (v_user_id, now(), 1)
  on conflict (user_id) do update set
    attempt_count = case
      when public.group_join_attempts.window_started_at < now() - interval '10 minutes' then 1
      else public.group_join_attempts.attempt_count + 1
    end,
    window_started_at = case
      when public.group_join_attempts.window_started_at < now() - interval '10 minutes' then now()
      else public.group_join_attempts.window_started_at
    end
  returning attempt_count into v_attempts;

  if v_attempts > 8 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited', 'message', 'Too many attempts. Wait 10 minutes before trying again.');
  end if;

  select * into v_group from public.groups where code = p_code;
  if v_group.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_code', 'message', 'No group was found for that code.');
  end if;

  insert into public.group_members(group_id, user_id, display_name, role)
  values (v_group.id, v_user_id, v_display_name, 'member')
  on conflict (group_id, user_id) do nothing
  returning group_id into v_joined_group_id;

  if v_joined_group_id is null then
    return jsonb_build_object('ok', false, 'code', 'already_member', 'message', 'You are already a member of this group.');
  end if;
  return jsonb_build_object('ok', true, 'group_id', v_group.id, 'name', v_group.name, 'code', v_group.code);
end;
$$;

create or replace function public.create_group_expense(
  p_group_id uuid,
  p_name text,
  p_emoji text,
  p_amount numeric,
  p_paid_by_user_id uuid,
  p_expense_date date,
  p_shares jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_expense_id uuid;
  v_total numeric(12, 2);
  v_share_total numeric(12, 2);
  v_share_count integer;
  v_valid_count integer;
  v_payer_name text;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not public.is_group_member(p_group_id) then raise exception 'Group not found or access denied' using errcode = '42501'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then raise exception 'Expense name is required' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero' using errcode = '22023'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group_id and user_id = p_paid_by_user_id) then
    raise exception 'Payer must be a group member' using errcode = '22023';
  end if;
  if jsonb_typeof(p_shares) <> 'array' then
    raise exception 'Expense shares must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_shares) = 0 then
    raise exception 'At least one participant share is required' using errcode = '22023';
  end if;

  select count(*), coalesce(sum((share ->> 'amount')::numeric), 0), count(distinct (share ->> 'user_id')::uuid)
  into v_share_count, v_share_total, v_valid_count
  from jsonb_array_elements(p_shares) as shares(share);
  if v_share_count <> v_valid_count then raise exception 'Each member may only have one share' using errcode = '22023'; end if;
  if round(v_share_total, 2) <> round(p_amount, 2) then raise exception 'Shares must add up to the expense amount' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_shares) as shares(share)
    where (share ->> 'amount')::numeric < 0
      or not exists (
        select 1 from public.group_members gm
        where gm.group_id = p_group_id and gm.user_id = (share ->> 'user_id')::uuid
      )
  ) then raise exception 'All participants must be group members with non-negative shares' using errcode = '22023'; end if;

  select display_name into v_payer_name from public.group_members
  where group_id = p_group_id and user_id = p_paid_by_user_id;
  v_total := round(p_amount, 2);

  insert into public.expenses(id, user_id, group_id, name, emoji, paid_by, paid_by_user_id, amount, created_at, expense_date)
  values (gen_random_uuid(), v_user_id, p_group_id, btrim(p_name), coalesce(nullif(p_emoji, ''), '🧾'), v_payer_name, p_paid_by_user_id, v_total, now(), coalesce(p_expense_date, current_date))
  returning id into v_expense_id;

  insert into public.expense_shares(expense_id, user_id, amount)
  select v_expense_id, (share ->> 'user_id')::uuid, round((share ->> 'amount')::numeric, 2)
  from jsonb_array_elements(p_shares) as shares(share);

  return v_expense_id;
end;
$$;

revoke all on function public.create_group(text) from public, anon;
revoke all on function public.join_group_by_code(text) from public, anon;
revoke all on function public.create_group_expense(uuid, text, text, numeric, uuid, date, jsonb) from public, anon;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group_by_code(text) to authenticated;
grant execute on function public.create_group_expense(uuid, text, text, numeric, uuid, date, jsonb) to authenticated;

commit;
