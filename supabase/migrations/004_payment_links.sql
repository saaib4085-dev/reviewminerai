-- =====================================================================
-- Review Miner: Stripe Payment Links support (run after 001–003)
-- If someone pays through a Payment Link before they have an account,
-- their credits are held here and added the moment they sign up with
-- the same email.
-- Supabase > SQL Editor > New query > paste > Run.
-- =====================================================================

create table if not exists public.pending_credit_purchases (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  credits            numeric(10,1) not null check (credits > 0),
  stripe_session_id  text not null unique,
  claimed_by         uuid references auth.users(id) on delete set null,
  claimed_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists pending_credit_purchases_email_idx
  on public.pending_credit_purchases (lower(email))
  where claimed_at is null;

drop trigger if exists pending_credit_purchases_updated_at on public.pending_credit_purchases;
create trigger pending_credit_purchases_updated_at before update on public.pending_credit_purchases
  for each row execute function public.set_updated_at();

-- Server only: RLS on with no policies, so only the service role can read or write.
alter table public.pending_credit_purchases enable row level security;

-- New users: profile + 3 free credits + any purchases made with their email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric := 3;
  r record;
begin
  insert into public.profiles (user_id, email, credits)
  values (new.id, new.email, 3)
  on conflict (user_id) do nothing;

  insert into public.credit_transactions (user_id, amount, balance_after, reason)
  values (new.id, 3, 3, 'signup_bonus');

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
