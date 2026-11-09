-- =====================================================================
-- Review Miner: several links per chat + 15 free credits (run after 001–005)
-- Supabase > SQL Editor > New query > paste > Run.
-- =====================================================================

-- Links sent together share a group_id so they show up as one chat.
alter table public.analyses add column if not exists group_id uuid;
create index if not exists analyses_user_group_idx on public.analyses (user_id, group_id);

-- 15 free credits for new accounts (existing balances are unchanged).
alter table public.profiles alter column credits set default 15;

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = user_id and credits <= 15);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric := 15;
  r record;
begin
  insert into public.profiles (user_id, email, credits)
  values (new.id, new.email, 15)
  on conflict (user_id) do nothing;

  insert into public.credit_transactions (user_id, amount, balance_after, reason)
  values (new.id, 15, 15, 'signup_bonus');

  -- Add any credits bought through a Payment Link before signing up.
  if new.email is not null then
    for r in
      select * from public.pending_credit_purchases
       where lower(email) = lower(new.email)
         and claimed_at is null
       order by created_at
       for update
    loop
      v_balance := v_balance + r.credits;

      update public.profiles set credits = credits + r.credits where user_id = new.id;

      insert into public.credit_transactions (user_id, amount, balance_after, reason, stripe_session_id)
      values (new.id, r.credits, v_balance, 'purchase', r.stripe_session_id)
      on conflict (stripe_session_id) do nothing;

      update public.pending_credit_purchases
         set claimed_by = new.id, claimed_at = now()
       where id = r.id;
    end loop;
  end if;

  return new;
end;
$$;
