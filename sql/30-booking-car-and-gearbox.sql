-- ===========================================================================
-- WHOSE CAR, AND WHICH GEARBOX — now part of sql/31
--
-- This file added bookings.car and bookings.gearbox and the matching
-- booking-function parameters. sql/31 does all of that as well, plus the
-- driving level, and removes whatever version of the functions was there
-- before. Run sql/31-booking-level-and-learner.sql instead.
--
-- Left empty on purpose: running the old body after sql/31 would put a
-- second, older copy of each booking function next to the new one.
-- ===========================================================================

select 'sql/30 is included in sql/31 - run that file instead' as note;
