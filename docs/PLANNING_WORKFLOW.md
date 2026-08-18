# Planning workflow

This application treats operational actions as recommendations, not automatic approvals.

- The engine calculates the suggested action for each day.
- Extraordinary actions remain pending until the user accepts or rejects them.
- Pending actions are used provisionally so the user can see the projected scenario.
- Rejecting an action returns the day to the base schedule (or no operation when outside the schedule) and recalculates downstream backlog.
- Decisions after a changed day must be reviewed again because backlog is sequential.

Headcount is decomposed into:

- checkout HC = operational checkouts × people per checkout × shifts;
- support HC = separation + packing + box + routing + replenishment, according to the configured dimensioning rule;
- total HC = checkout HC + support HC.
