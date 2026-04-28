-- ============================================================
-- Add SuperAdmin user (role 2)
-- Email: superadmin@kggeniuslabs.com
-- Password: superadmin@123
-- ============================================================

INSERT INTO `cocube_user` (`name`, `phonenumber`, `emailid`, `password`, `role`, `log_status`, `submitted`)
SELECT 'superadmin', 0000000000, 'superadmin@kggeniuslabs.com', 'superadmin@123', 2, 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM `cocube_user` WHERE `emailid` = 'superadmin@kggeniuslabs.com'
);
