-- Two optional numbers next to the target (TJH/SJH only; never WGW's, whose health data stays off the site):
-- max HR from a race or test, and resting HR. They set the easy ceiling in lib/metrics.js. Nothing else is asked.
ALTER TABLE goals ADD COLUMN max_hr INTEGER;
ALTER TABLE goals ADD COLUMN rest_hr INTEGER;
