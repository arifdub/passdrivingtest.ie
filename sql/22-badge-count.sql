-- ===========================================================================
-- 22. The number on the app icon
--
-- iOS will put a count on a home-screen app's icon, but only if something
-- tells it one. A push arriving while the app is closed is the only moment
-- that number can change, and the service worker handling that push has no
-- session: it cannot call my_waiting(), which reads auth.uid().
--
-- So the count travels in the push payload, and this is where it comes
-- from. It is my_waiting()'s `unseen` expression and nothing else —
-- copied logic would be two numbers that drift, and a badge that disagrees
-- with the bell beside it is worse than no badge at all.
--
-- WHO MAY CALL IT
--
-- Nobody with a session. It takes a user id as an argument, which means a
-- signed-in caller could ask for somebody else's backlog — a small leak,
-- but a real one. Execute is granted to service_role only, which reaches
-- it through api/notify.js and never from a browser. Signed-in code keeps
-- using my_waiting(), which takes no argument and can only ever answer for
-- the caller.
-- ===========================================================================

create or replace function public.waiting_count_for(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with seen as (
    select coalesce(
      (select notifications_seen_at from public.profiles where id = p_user),
      'epoch'::timestamptz
    ) as at
  )
  select
    (select count(*) from public.bookings cross join seen
      where instructor_id = p_user
        and status = 'requested'
        and created_at > seen.at)
    +
    (select count(*) from public.instructor_enquiries cross join seen
      where instructor_id = p_user
        and status = 'new'
        and created_at > seen.at)
    +
    (select count(*) from public.booking_messages m
      join public.bookings b on b.id = m.booking_id
      cross join seen
     where p_user in (b.instructor_id, b.learner_id)
       and m.sender_id <> p_user
       and m.read_at is null
       and b.status in ('requested', 'accepted')
       and m.created_at > seen.at);
$$;

-- The default grant is to public. Taking it back is the whole point.
revoke all on function public.waiting_count_for(uuid) from public, anon, authenticated;
grant execute on function public.waiting_count_for(uuid) to service_role;

comment on function public.waiting_count_for(uuid) is
  'The badge number for one person: my_waiting().unseen, for a caller with no session. service_role only — a signed-in caller must use my_waiting().';
