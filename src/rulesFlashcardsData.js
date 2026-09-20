/*
  ===========================================================================
  RULES OF THE ROAD FLASHCARDS — 153 cards across 20 topic categories.

  Extracted unchanged from the original App.jsx so the app can import them
  like every other content file. Nothing here was rewritten.
  ===========================================================================
*/

export const RULES_CATEGORIES = [
  { id: "licences",   label: "Licences & Categories",   swatch: "bg-blue-600" },
  { id: "learner",     label: "Learner Driver",          swatch: "bg-sky-600" },
  { id: "test",        label: "Driving Test",            swatch: "bg-indigo-600" },
  { id: "vehicle",     label: "Vehicle Safety",          swatch: "bg-emerald-600" },
  { id: "practice",    label: "Good Driving Practice",   swatch: "bg-teal-600" },
  { id: "signs",       label: "Signs & Road Markings",   swatch: "bg-red-600" },
  { id: "lights",      label: "Lights & Signals",        swatch: "bg-amber-500", dark: true },
  { id: "speed",       label: "Speed Limits",            swatch: "bg-orange-600" },
  { id: "junctions",   label: "Junctions & Roundabouts", swatch: "bg-purple-600" },
  { id: "parking",     label: "Parking",                 swatch: "bg-fuchsia-600" },
  { id: "motorway",    label: "Motorways & Tunnels",     swatch: "bg-blue-800" },
  { id: "garda",       label: "Assisting Gardai",        swatch: "bg-slate-600" },
  { id: "impair",      label: "Alcohol, Drugs & Fatigue",swatch: "bg-rose-600" },
  { id: "incident",    label: "Incident Scene",          swatch: "bg-red-800" },
  { id: "points",      label: "Penalty Points & Bans",   swatch: "bg-yellow-500", dark: true },
  { id: "moto",        label: "Motorcyclists",           swatch: "bg-cyan-600" },
  { id: "cycle",       label: "Cyclists & E-Scooters",   swatch: "bg-lime-600", dark: true },
  { id: "pedestrian",  label: "Pedestrians",             swatch: "bg-green-600" },
  { id: "otherusers",  label: "Other Road Users",        swatch: "bg-stone-600" },
  { id: "recognise",   label: "Sign Recognition",        swatch: "bg-red-700" },
];
export const RULES_CAT = Object.fromEntries(RULES_CATEGORIES.map(c => [c.id, c]));

const RAW_RULES_CARDS = [
  // ---------------- LICENCES & CATEGORIES ----------------
  { c: "licences", q: "Minimum age for a first learner permit — category B (car)?", a: "17 years old." },
  { c: "licences", q: "Minimum age for category A1 (small motorcycle, up to 125cc)?", a: "16 years old." },
  { c: "licences", q: "Minimum age to ride an unrestricted category A motorcycle without progressive access?", a: "24 years old (or 20 with progressive access)." },
  { c: "licences", q: "What licence category covers work vehicles and land tractors?", a: "Category W — minimum age 16." },
  { c: "licences", q: "On a full category B licence, when can you tow a trailer without needing category BE?", a: "When the trailer's MAM is 750kg or less, or the combined vehicle+trailer weight is 3,500kg or less." },
  { c: "licences", q: "Who needs a Driver CPC (Certificate of Professional Competence)?", a: "Professional bus drivers (D, D1, DE, D1E) and professional truck drivers (C, C1, CE, C1E)." },
  { c: "licences", q: "How long is a full car/motorcycle driving licence valid for?", a: "10 years (5 years for trucks and buses)." },
  { c: "licences", q: "How long must you display N-plates after getting your first full licence?", a: "2 years — you're a 'novice driver' for that period." },

  // ---------------- LEARNER DRIVER ----------------
  { c: "learner", q: "Must a learner permit holder for category B always be accompanied?", a: "Yes — by a qualified driver who has held a full licence in that category for 2 continuous years." },
  { c: "learner", q: "Do AM/A1/A2/A learner permit holders need an accompanying qualified driver?", a: "No, but they can't ride unsupervised until they've completed Initial Basic Training (IBT)." },
  { c: "learner", q: "What colour and letter must L-plates show, and minimum letter height?", a: "A red 'L' on a white background, at least 15cm tall, with a 2cm border." },
  { c: "learner", q: "How do motorcycle/moped learners (A, A1, A2, AM) display their L-plates?", a: "On a yellow fluorescent tabard worn on the body, visible front and back." },
  { c: "learner", q: "How many one-hour sessions make up Essential Driver Training (EDT)?", a: "12 sessions, with an Approved Driving Instructor (ADI)." },
  { c: "learner", q: "How many hours is Initial Basic Training (IBT) for motorcyclists, and how many modules?", a: "16 hours, in 4 sequential modules." },
  { c: "learner", q: "What is the 'six-month rule' for first-time learner permit holders?", a: "You can't sit your driving test for 6 months after the permit starts (categories A, A1, A2, AM, B, W)." },
  { c: "learner", q: "What's the drink-drive alcohol limit for learner, novice and professional drivers?", a: "20mg of alcohol per 100ml of blood." },

  // ---------------- DRIVING TEST ----------------
  { c: "test", q: "How long before your test appointment should you arrive at the test centre?", a: "At least 10 minutes early." },
  { c: "test", q: "Roughly how long does the test last for categories A, A1, A2, AM, B, BE and W?", a: "About 40 minutes, over roughly 8–10km." },
  { c: "test", q: "What do you get if you pass your driving test?", a: "A Certificate of Competency — exchange it for your full licence within 2 years." },
  { c: "test", q: "Name three reasons your driving test could be cancelled (fee lost).", a: "Any of: arriving late; wrong/missing discs or L-plates; unroadworthy vehicle; wrong vehicle for the category." },
  { c: "test", q: "What is 'progressive access' for motorcyclists?", a: "Moving to a higher motorcycle licence category without an extra test, after holding the lower category long enough." },

  // ---------------- VEHICLE SAFETY ----------------
  { c: "vehicle", q: "What is the legal minimum tyre tread depth?", a: "1.6mm across the main tread (though it's wise to replace at 3mm)." },
  { c: "vehicle", q: "When may you use fog lights?", a: "Only in dense fog or falling snow — switch them off otherwise." },
  { c: "vehicle", q: "Who may fit blue or red flashing lights to a vehicle?", a: "No one except Gardai, ambulances and other designated emergency service vehicles." },
  { c: "vehicle", q: "A child must use a child restraint system (CRS) until what height/weight?", a: "Until they're 150cm tall or 36kg, whichever comes first." },
  { c: "vehicle", q: "What EU child-seat standard replaced the older R44 standard from 1 September 2024?", a: "R129 (i-Size) — R44 seats can no longer be sold in the EU." },
  { c: "vehicle", q: "Can you place a rear-facing child seat in a seat with an active frontal airbag?", a: "No — never. It can cause serious injury or death if the airbag deploys." },
  { c: "vehicle", q: "What's the fine/penalty range for using a hand-held mobile phone while driving?", a: "A fixed charge and up to 5 penalty points." },
  { c: "vehicle", q: "What's the penalty for texting/emailing while driving?", a: "Compulsory court appearance, a judge-set fine, and possibly up to 3 months in prison for repeat offences — no fixed-charge option." },

  // ---------------- GOOD DRIVING PRACTICE ----------------
  { c: "practice", q: "How much space should you give a cyclist when overtaking, in a zone up to 50km/h?", a: "At least 1 metre." },
  { c: "practice", q: "How much space should you give a cyclist when overtaking, above 50km/h?", a: "At least 1.5 metres." },
  { c: "practice", q: "How long must a 'LONG VEHICLE' sign be displayed — what's the minimum vehicle length?", a: "13 metres or more." },
  { c: "practice", q: "Can you overtake on the left?", a: "Yes — e.g. if the vehicle ahead is turning right and you're going straight, if you've signalled left, or in slow stop-start traffic where your lane is faster." },
  { c: "practice", q: "Name three places you must never overtake.", a: "Any of: near a pedestrian crossing; approaching a junction, bend, dip, hilltop or narrow road; in the left lane of a motorway/dual carriageway at normal speed." },
  { c: "practice", q: "What's the maximum gap allowed between a towing vehicle and trailer without a warning device?", a: "1.5 metres — beyond that (up to 4.5m max) you need a warning device such as a white flag at least 30cm square." },
  { c: "practice", q: "At night, roughly how far do dipped headlights let you see?", a: "About 30 metres (full headlights: about 100 metres)." },
  { c: "practice", q: "When must you not use your horn in a built-up area?", a: "Between 11:30pm and 7am, unless there's a traffic emergency." },

  // ---------------- SIGNS & ROAD MARKINGS ----------------
  { c: "signs", q: "What shape and colour is a Stop sign, uniquely in the whole sign system?", a: "A red octagon with a white border — the only sign of that shape." },
  { c: "signs", q: "What does an advanced stop line for cyclists mean for drivers?", a: "Drivers must stop at the first white line they reach and not enter the shaded box reserved for cyclists." },
  { c: "signs", q: "What does a single broken yellow line at the roadside mark?", a: "A hard shoulder — mainly for pedestrians/cyclists; you may briefly pull in to let a vehicle overtake." },
  { c: "signs", q: "What colour and shape are warning signs, and what do they mean?", a: "Yellow diamonds/rectangles with a black border and black symbol — they warn of a hazard ahead." },
  { c: "signs", q: "What colour are roadworks warning signs, as opposed to ordinary warning signs?", a: "Orange (with black border/symbols), instead of yellow." },
  { c: "signs", q: "What do the three information-sign background colours mean?", a: "Blue = motorways, green = national roads, white = local/regional roads." },
  { c: "signs", q: "At roadworks, what must you do at a Stop/Go (Teigh) sign?", a: "Stop completely on Stop; only proceed when Go/Teigh is shown." },
  { c: "signs", q: "What does hatched (diagonal-striped) road marking mean?", a: "An area you must never drive into — used for merging, diverging or separating traffic." },

  // ---------------- LIGHTS & SIGNALS ----------------
  { c: "lights", q: "Does a green traffic light give you right of way?", a: "No — it means you may proceed with caution only if the way is clear." },
  { c: "lights", q: "When can you go through an amber light?", a: "Only if you're already so close to the stop line that stopping safely isn't possible." },
  { c: "lights", q: "What does a flashing amber arrow at a junction mean?", a: "You may proceed, but only after giving way to traffic already crossing from the other road." },
  { c: "lights", q: "What should you do if traffic lights at a junction are out of order?", a: "Treat it as a give-way junction: stop at the control line and proceed only when safe, yielding to others with right of way." },
  { c: "lights", q: "Does signalling ever give you right of way?", a: "No — a signal only shows your intention, never a right of way." },
  { c: "lights", q: "What does a red light showing a cyclist figure at a cycle-track signal mean?", a: "Cyclists, e-scooter and L1e-A e-moped riders must stop." },

  // ---------------- SPEED LIMITS ----------------
  { c: "speed", q: "Default speed limit on a motorway?", a: "120km/h." },
  { c: "speed", q: "Default speed limit on national roads (primary and secondary)?", a: "100km/h." },
  { c: "speed", q: "Default speed limit on regional roads?", a: "80km/h." },
  { c: "speed", q: "Default speed limit on local roads?", a: "60km/h." },
  { c: "speed", q: "Default speed limit in built-up areas (cities, towns, boroughs)?", a: "50km/h." },
  { c: "speed", q: "Special speed limit used in densely populated/built-up zones?", a: "30km/h." },
  { c: "speed", q: "What is the 'two-second rule'?", a: "Keep at least a two-second gap behind the vehicle in front — double it in the wet, 4–5x in snow/fog/ice." },
  { c: "speed", q: "Vehicle speed limit for a goods vehicle over 3,500kg MAM, on a motorway?", a: "90km/h." },
  { c: "speed", q: "Vehicle speed limit for any vehicle towing a trailer, caravan or horsebox?", a: "80km/h on all roads." },
  { c: "speed", q: "Roughly what share of pedestrians die if hit by a car at 60km/h, vs 30km/h?", a: "About 9 in 10 at 60km/h, but only about 1 in 10 at 30km/h." },

  // ---------------- JUNCTIONS & ROUNDABOUTS ----------------
  { c: "junctions", q: "At a junction of roads of equal importance, who has right of way?", a: "Traffic coming from your right." },
  { c: "junctions", q: "Must you always yield to pedestrians already crossing at a junction?", a: "Yes, always." },
  { c: "junctions", q: "When may you enter a yellow box junction?", a: "Only if you can clear it without stopping — except when turning right, where you may wait in it for a gap in oncoming traffic." },
  { c: "junctions", q: "The roundabout 'golden rule': which lane for an exit between 6 and 12 o'clock?", a: "Approach in the left-hand lane." },
  { c: "junctions", q: "The roundabout 'golden rule': which lane for an exit between 12 and 6 o'clock?", a: "Approach in the right-hand lane." },
  { c: "junctions", q: "At a crossroads, if you and an oncoming driver are both turning right, what's the safest approach?", a: "Turn 'back to back' (behind each other) if possible, or 'near-side to near-side' if not." },
  { c: "junctions", q: "On a dual carriageway, which lane should you normally drive in?", a: "The left-hand lane — use the outer lane only for overtaking or an imminent right turn." },
  { c: "junctions", q: "At a T-junction, who has right of way?", a: "Traffic already on the through-road; traffic joining from the road that ends there must wait." },

  // ---------------- PARKING ----------------
  { c: "parking", q: "What do double yellow lines mean?", a: "No parking at any time." },
  { c: "parking", q: "How close before a pedestrian crossing must you not park?", a: "15 metres before (and 5 metres after) the crossing." },
  { c: "parking", q: "How long can you park in a loading bay?", a: "Up to 30 minutes, only while loading/unloading goods." },
  { c: "parking", q: "What is a 'clearway'?", a: "A stretch of road that must stay clear of stopped/parked vehicles during posted busy periods." },
  { c: "parking", q: "Fine/penalty for dangerous parking?", a: "A fixed charge of €80 and up to 5 penalty points." },
  { c: "parking", q: "How close to a junction must you not park (unless a bay is marked)?", a: "Within 5 metres." },
  { c: "parking", q: "Can you park in a disabled persons' bay just to drop someone off quickly?", a: "No — only a valid permit holder, and generally for the permit holder's own use." },
  { c: "parking", q: "Under disc parking, how soon can you re-park in the same street after leaving a space?", a: "Not within 1 hour of leaving." },

  // ---------------- MOTORWAYS & TUNNELS ----------------
  { c: "motorway", q: "Name three types of road user banned from motorways.", a: "Any of: cyclists, pedestrians, animals, learner permit holders, vehicles under 50km/h or 50cc or less, invalid carriages." },
  { c: "motorway", q: "Approximate total stopping distance at 120km/h in the dry?", a: "About 102 metres — roughly 27 car lengths." },
  { c: "motorway", q: "Which lane on a motorway is banned to HGVs, trailers and standing-passenger buses?", a: "The outermost lane (Lane 2 or 3, whichever is furthest from the hard shoulder)." },
  { c: "motorway", q: "When may you stop or park on a motorway?", a: "Only if you break down, a Garda signals you to, there's an emergency, roadworks, or you're at a toll plaza." },
  { c: "motorway", q: "What should you never place on a motorway hard shoulder in a breakdown?", a: "A warning triangle — it's too dangerous." },
  { c: "motorway", q: "Recommended minimum distance behind the vehicle ahead in a road tunnel?", a: "50 metres for cars/motorcycles, 100 metres for other vehicles." },
  { c: "motorway", q: "What does a flashing red light at a level crossing or tunnel mean?", a: "The same as a steady red traffic light — stop." },
  { c: "motorway", q: "What should you do if a fire breaks out ahead of you inside a tunnel?", a: "Switch off the engine, leave the vehicle immediately, and exit via the nearest emergency exit." },
  { c: "motorway", q: "What are LRI and LRM signs used for on a motorway hard shoulder?", a: "To help you give your exact location (road, direction, distance) in a breakdown or emergency." },
  { c: "motorway", q: "How do you know your exit is coming up 300m, 200m, 100m ahead?", a: "Countdown markers on the approach to the exit." },

  // ---------------- ASSISTING GARDAI ----------------
  { c: "garda", q: "Do Garda hand signals override traffic lights?", a: "Yes — a Garda's signal always overrides the lights." },
  { c: "garda", q: "Within how many days must you produce your insurance certificate if asked?", a: "10 days." },
  { c: "garda", q: "Is refusing a roadside breath/saliva sample a criminal offence?", a: "Yes." },
  { c: "garda", q: "When an emergency vehicle approaches with lights/siren, what should you never do?", a: "Never tailgate or overtake it, run a red light, brake suddenly, or block the road." },
  { c: "garda", q: "Should you ever mount the kerb to let an emergency vehicle pass?", a: "Only if absolutely necessary, and only if you're certain no pedestrians are there." },

  // ---------------- ALCOHOL, DRUGS & FATIGUE ----------------
  { c: "impair", q: "What BAC range triggers an on-the-spot €200 fine and 3-month ban for a qualified driver?", a: "50–80mg per 100ml of blood." },
  { c: "impair", q: "What BAC range triggers an on-the-spot €400 fine and 6-month ban?", a: "80–100mg per 100ml of blood." },
  { c: "impair", q: "What's the automatic ban for refusing an evidential breath/blood/urine sample, first offence?", a: "4 years (6 years for a second or subsequent offence)." },
  { c: "impair", q: "Name the five roadside 'impairment tests' Gardai may use for suspected drug driving.", a: "Pupil dilation, balance, walk-and-turn, one-leg stand, and finger-to-nose." },
  { c: "impair", q: "How long can a 'micro-sleep' last, and how far can a car travel in just 4 seconds of one?", a: "Up to 10 seconds; roughly 100 metres in 4 seconds — more than a football pitch." },
  { c: "impair", q: "What's the recommended maximum length for an emergency 'tiredness nap' while driving?", a: "20 minutes (have a strong coffee first — it takes about 20 minutes to kick in)." },
  { c: "impair", q: "What should you do if another driver tries to provoke you (road rage)?", a: "Stay calm, don't react, don't speed up/brake/swerve — focus on driving safely and report it." },
  { c: "impair", q: "Maximum fine/prison term for drug driving on summary conviction?", a: "Up to €5,000 and/or up to 6 months in prison." },

  // ---------------- INCIDENT SCENE ----------------
  { c: "incident", q: "If you're involved in a crash, what must you do at the scene?", a: "Stop, stay a reasonable time, and help anyone injured or in need of assistance." },
  { c: "incident", q: "Penalty for leaving the scene knowing someone is injured or killed, to escape liability?", a: "Up to €20,000 fine or up to 10 years in prison." },
  { c: "incident", q: "Should you remove an injured motorcyclist's helmet?", a: "No — inexperienced removal risks paralysis from neck injuries." },
  { c: "incident", q: "Should you give an injured person food or drink at the scene?", a: "No." },
  { c: "incident", q: "When must Gardai carry out mandatory alcohol testing after a crash?", a: "At the scene of any crash involving injury, or of an injured driver taken to hospital." },

  // ---------------- PENALTY POINTS & BANS ----------------
  { c: "points", q: "How many points in 36 months bans a fully licensed driver?", a: "12 or more points → 6-month ban." },
  { c: "points", q: "How many points in 36 months bans a learner or novice driver?", a: "7 or more points → 6-month ban." },
  { c: "points", q: "How many days do you have to pay a fixed-charge notice before it increases by 50%?", a: "28 days." },
  { c: "points", q: "When do points get added to your licence after a fixed-charge notice?", a: "28 days after you're notified (triggered by payment or conviction)." },
  { c: "points", q: "How many days do you have to surrender your licence once a ban starts?", a: "14 days — post it to the NDLS." },
  { c: "points", q: "Does time spent banned count toward your 36-month points window?", a: "No — the window is extended to cover the time lost." },

  // ---------------- MOTORCYCLISTS ----------------
  { c: "moto", q: "What's the fine for riding, or letting a passenger ride, without a helmet?", a: "A fixed charge of €80." },
  { c: "moto", q: "How many pillion passengers may a motorcycle carry?", a: "No more than one, on a proper seat, facing forward, feet reaching the footrests." },
  { c: "moto", q: "What acronym helps riders remember pre-ride checks?", a: "POWDERS — Petrol, Oil, Water, Damage, Electrics, Rubber (tyres), Security." },
  { c: "moto", q: "Minimum legal tyre tread depth for a motorcycle?", a: "1mm — but replace well before that." },
  { c: "moto", q: "Should motorcyclists ride between traffic lanes (filtering)?", a: "No — avoid it." },
  { c: "moto", q: "What proportion of road deaths in Ireland involve motorcyclists, despite being under 1 in 50 licensed vehicles?", a: "About 1 in 8 road deaths." },

  // ---------------- CYCLISTS & E-SCOOTERS ----------------
  { c: "cycle", q: "Minimum age to ride an e-scooter in a public place?", a: "16 years old." },
  { c: "cycle", q: "Maximum legal speed for an e-scooter?", a: "20km/h (or a lower posted limit)." },
  { c: "cycle", q: "Do you need a licence or insurance for a legal e-scooter?", a: "No — none required." },
  { c: "cycle", q: "At what speed does an e-bike's motor assistance have to cut out?", a: "25km/h — and it must only assist pedalling, not propel on its own." },
  { c: "cycle", q: "What's the maximum power/speed for an L1e-A e-moped?", a: "Up to 1,000W, maximum 25km/h." },
  { c: "cycle", q: "What's the maximum power/speed for an L1e-B e-moped?", a: "Up to 4,000W, maximum 45km/h — treated like a motorbike, always needs an AM licence." },
  { c: "cycle", q: "A continuous white line on a cycle track means what?", a: "It's a mandatory cycle track — no other vehicle may cross it or park there (except entering/leaving a driveway)." },
  { c: "cycle", q: "What braking system must an adult bicycle have?", a: "Two brakes — one on the front wheel, one on the back." },
  { c: "cycle", q: "Is a cycle helmet legally required in Ireland?", a: "No, but it's strongly recommended for safety." },
  { c: "cycle", q: "Fixed charge for cycling through a red light?", a: "€40." },

  // ---------------- PEDESTRIANS ----------------
  { c: "pedestrian", q: "If there's no footpath, which side of the road should a pedestrian walk on?", a: "The right-hand side, facing oncoming traffic." },
  { c: "pedestrian", q: "At a zebra crossing, when do you get right of way as a pedestrian?", a: "Only once you actually step onto the crossing — not before." },
  { c: "pedestrian", q: "What does a flashing amber light at a pelican crossing mean for pedestrians?", a: "It gives priority to any pedestrian still on the crossing." },
  { c: "pedestrian", q: "What's different about a toucan crossing compared to a zebra crossing?", a: "It's shared by pedestrians and cyclists together and relies solely on traffic lights, not stripes." },
  { c: "pedestrian", q: "Where should you never cross the road, relating to buses?", a: "In front of a stopped bus — you can't be seen by traffic behind it." },
  { c: "pedestrian", q: "Roughly what share of Irish road deaths are pedestrians?", a: "About 1 in 5." },

  // ---------------- OTHER ROAD USERS ----------------
  { c: "otherusers", q: "What must an adult school warden's raised Stop sign make you do?", a: "Stop and remain stopped until the children have crossed, the sign is lowered, and the warden is back on the footpath." },
  { c: "otherusers", q: "When leading a horse on the road, where should you walk?", a: "Between the horse and the traffic." },
  { c: "otherusers", q: "Should you use your horn or headlights near a horse?", a: "No — it could startle the horse and cause the rider to lose control." },
  { c: "otherusers", q: "What must a horse-drawn vehicle carry at night?", a: "Two red rear reflectors, and on the right-hand side, a lamp showing white to the front and red to the back." },
  { c: "otherusers", q: "What safety equipment must all tractors used in public places have?", a: "An approved safety frame, to protect the driver in a rollover." },

  // ---------------- SIGN RECOGNITION ----------------
  { c: "recognise", q: "What does a red octagon always mean?", a: "Stop." },
  { c: "recognise", q: "What does a red-bordered triangle pointing downward mean?", a: "Yield — give way." },
  { c: "recognise", q: "White background, red border, circular shape — what family of sign is this?", a: "A regulatory sign (a legal requirement you must obey)." },
  { c: "recognise", q: "Blue background, white symbol, circular shape — what does this sign family mean?", a: "A mandatory instruction (e.g. the direction you must take)." },
  { c: "recognise", q: "Yellow diamond, black border, black symbol — what family of sign is this?", a: "A warning sign — a hazard ahead." },
  { c: "recognise", q: "Orange diamond/rectangle, black border — what family of sign is this?", a: "A roadworks warning sign." },
  { c: "recognise", q: "Blue rectangle sign — what road type does this mean?", a: "A motorway." },
  { c: "recognise", q: "Green rectangle sign — what road type does this mean?", a: "A national road." },
  { c: "recognise", q: "White rectangle sign with black text — what road type does this mean?", a: "A local or regional road." },
  { c: "recognise", q: "What does a red circle with a white horizontal bar mean?", a: "No entry." },
  { c: "recognise", q: "What does a white triangular symbol painted on the road, near a broken line, indicate?", a: "A Yield line — give way to traffic on the major road ahead." },
  { c: "recognise", q: "What does criss-crossed yellow lines on the road (a 'yellow box') mean?", a: "Don't enter unless you can clear it without stopping (except waiting to turn right)." },
  { c: "recognise", q: "What does a red flashing light at a level crossing mean?", a: "Stop — same as a steady red traffic light. Never zigzag around the barriers." },
  { c: "recognise", q: "What colour tabard must a learner motorcyclist wear their L-plate on?", a: "Yellow fluorescent." },
  { c: "recognise", q: "What does a white arrow in a white-edged box at a signalled junction mean?", a: "A turning box — position here for a right turn, and don't enter on a red light." },
];

// Sequential ids, grouped by the category order above — kept stable so a
// learner's "known" marks still point at the same card next release.
export const RULES_CARDS = (() => {
  let n = 0;
  return RULES_CATEGORIES.flatMap(cat =>
    RAW_RULES_CARDS
      .filter(card => card.c === cat.id)
      .map(card => ({ ...card, id: ++n }))
  );
})();

export default RULES_CARDS;
