-- =====================================================================
-- Review Miner: create 100 Apex vouchers (1000 credits + Apex tier each)
-- Run AFTER 013_tiers.sql. Each run adds 100 more.
--
-- Format: APEX-1000-XXXX-XXXX. The 8 random characters come from a secure random
-- generator and a 32-letter alphabet (no 0/O or 1/I): over 1 trillion possibilities,
-- so codes can't be guessed.
-- =====================================================================

do $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  inserted int := 0;
  bytes bytea;
  part text;
  i int;
begin
  while inserted < 100 loop
    bytes := gen_random_bytes(8);
    part := '';
    for i in 0..7 loop
      if i = 4 then
        part := part || '-';
      end if;
      part := part || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;

    insert into public.promo_codes (code, credits, tier, redeemed)
    values ('APEX-1000-' || part, 1000, 'Apex', false)
    on conflict (code) do nothing;      -- in the rare case of a duplicate, try again

    if found then
      inserted := inserted + 1;
    end if;
  end loop;
end;
$$;

-- Your unused Apex codes (export the results as CSV):
select code, credits, tier, created_at
  from public.promo_codes
 where tier = 'Apex' and code like 'APEX-1000-%' and redeemed = false
 order by created_at desc;
