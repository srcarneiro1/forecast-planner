# Planning workflow

The planner follows the operating logic of `PLANO_PRODUCAO_BLACK_CAFFEINE_2026_v2`, while moving limits that were embedded in spreadsheet formulas into explicit parameters.

## Decision flow

- The engine calculates the base capacity for each day.
- When base capacity is insufficient on a business day, the engine suggests the configured overtime action.
- Overtime is not escalated automatically to a second or third shift just because backlog remains. The residual volume stays as backlog for the next day, matching the reference spreadsheet behavior.
- Weekend and operational-holiday work is suggested as an extraordinary action.
- Extraordinary actions remain pending until the user accepts or rejects them.
- Pending actions are used provisionally so the user can see the projected scenario.
- Rejecting an action returns the day to the base schedule (or no operation when outside the schedule) and recalculates downstream backlog.
- Decisions after a changed day must be reviewed again because backlog is sequential.

## Headcount

Headcount is decomposed into:

- checkout HC = operational checkouts × people per checkout;
- support HC = separation + packing + box + routing + replenishment, according to the configured dimensioning rule;
- total HC = checkout HC + support HC, limited by the configured HC maximum.

For overtime, the cost is calculated over the full planned HC for the day, not only incremental HC.

## Costs

Tariffs are loaded from Supabase and not hardcoded in the engine:

- business day;
- Saturday;
- Sunday/holiday;
- night rate (reserved for future shift scenarios).

Action cost = planned HC × action hours × applicable hourly tariff.

## Calendar

Operational holidays are loaded from the `feriados` table. The 2026 holidays marked as active in the reference spreadsheet were imported into this table so weekday holidays are treated as extraordinary operating days.
