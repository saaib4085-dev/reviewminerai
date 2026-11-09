-- =====================================================================
-- Review Miner: 9 free credits for new accounts (run after 001–004)
-- Supabase > SQL Editor > New query > paste > Run.
-- Existing accounts keep their current balance.
-- =====================================================================

alter table public.profiles alter column credits set default 9;

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = user_id and credits <= 9);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric := 9;
  r record;
begin
  insert into public.profiles (user_id, email, credits)
  values (new.id, new.email, 9)
  on conflict (user_id) do nothing;

  insert into public.credit_transactions (user_id, amount, balance_after, reason)
  values (new.id, 9, 9, 'signup_bonus');

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
