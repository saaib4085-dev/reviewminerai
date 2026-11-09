-- =====================================================================
-- Review Miner: create 1,000 single-use vouchers (100 credits each)
-- Run AFTER 007_vouchers.sql. Safe to run again: each run adds 1,000 more.
-- =====================================================================

do $$
declare
  inserted int := 0;
begin
  while inserted < 1000 loop
    insert into public.promo_codes (code, credits, redeemed)
    values (public.make_promo_code(), 100, false)
    on conflict (code) do nothing;   -- in the rare case of a duplicate, try again
    if found then
      inserted := inserted + 1;
    end if;
  end loop;
end;
$$;

-- See your unused codes (export from the results panel as CSV):
select code, credits, created_at
  from public.promo_codes
 where redeemed = false
 order by created_at desc;
