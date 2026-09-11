-- 20260907191649_update_fr_pfu_rates moved the French social-levies rate from
-- 17.2% to 18.6% in the DATA and never touched the column DEFAULT, so
-- schema.prisma has said 0.186 while the database has said 0.172 ever since.
--
-- That is not a cosmetic disagreement. Every `userSettings.upsert` creates its
-- row without naming this column, so Postgres supplies the default - and that
-- migration's own `WHERE "taxRatePea" = 0.172` had already run long before the
-- row existed, so nothing corrects it afterwards. A self-hoster installing
-- today is therefore offered 17.2% when creating a PEA, which is exactly the
-- stale-regulated-rate failure this project has already fixed once on the
-- savings side.
--
-- Invisible on any instance that already had a UserSettings row, which is why
-- it survived: it only shows on a chain replayed from zero.
ALTER TABLE "UserSettings" ALTER COLUMN "taxRatePea" SET DEFAULT 0.186;

-- Any row still on the old value was created BY that stale default - the
-- previous migration already moved every row that predated it - so this
-- cannot be overwriting a rate somebody typed in on purpose.
UPDATE "UserSettings" SET "taxRatePea" = 0.186 WHERE "taxRatePea" = 0.172;
