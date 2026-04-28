-- ============================================================
-- MIGRATION: Restructure DB for SuperAdmin, Businesses, 
--            Separate Port Slots & Client Question Assignments
-- ============================================================

-- 1. CREATE businesses TABLE
CREATE TABLE IF NOT EXISTS `businesses` (
  `business_id` INT NOT NULL AUTO_INCREMENT,
  `business_name` VARCHAR(255) NOT NULL,
  `business_code` VARCHAR(50) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `subscription_limit` INT NOT NULL DEFAULT 0,
  `subscription_used` INT NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`business_id`),
  UNIQUE KEY `uq_business_code` (`business_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 2. ADD business_id FK TO clients TABLE
ALTER TABLE `clients` ADD COLUMN `business_id` INT DEFAULT NULL AFTER `client_id`;
ALTER TABLE `clients` ADD CONSTRAINT `fk_client_business` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`business_id`) ON DELETE SET NULL;

-- 3. CREATE assessment_questions TABLE (for question_ids like a1l1q1, a1l1q2, a1l1q3)
CREATE TABLE IF NOT EXISTS `assessment_questions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `question_id` VARCHAR(20) NOT NULL,
  `question_name` VARCHAR(255) DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_question_id` (`question_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Seed existing question_ids
INSERT INTO `assessment_questions` (`question_id`, `question_name`, `description`) VALUES
  ('a1l1q1', 'Frontend Assessment Q1', 'Assessment 1 Level 1 Question 1'),
  ('a1l1q2', 'Frontend Assessment Q2', 'Assessment 1 Level 1 Question 2'),
  ('a1l1q3', 'Frontend Assessment Q3', 'Assessment 1 Level 1 Question 3');

-- 4. CREATE port_slots TABLE (separate from questions, 11000 ports each)
--    docker_port: 8081 to 19080
--    output_port: 5174 to 16173
CREATE TABLE IF NOT EXISTS `port_slots` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `docker_port` INT NOT NULL,
  `output_port` INT NOT NULL,
  `is_utilized` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_docker_port` (`docker_port`),
  UNIQUE KEY `uq_output_port` (`output_port`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Generate 11000 port_slots rows using a stored procedure
DELIMITER //
CREATE PROCEDURE populate_port_slots()
BEGIN
  DECLARE i INT DEFAULT 0;
  WHILE i < 11000 DO
    INSERT INTO `port_slots` (`docker_port`, `output_port`) 
    VALUES (8081 + i, 5174 + i);
    SET i = i + 1;
  END WHILE;
END //
DELIMITER ;

CALL populate_port_slots();
DROP PROCEDURE IF EXISTS populate_port_slots;

-- 5. CREATE client_questions TABLE (assign questions to clients instead of slots)
CREATE TABLE IF NOT EXISTS `client_questions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `client_id` INT NOT NULL,
  `question_id` VARCHAR(20) NOT NULL,
  `assigned_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_client_question` (`client_id`, `question_id`),
  CONSTRAINT `fk_cq_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`client_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cq_question` FOREIGN KEY (`question_id`) REFERENCES `assessment_questions` (`question_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 6. UPDATE launch_tokens to reference new port_slots and question_id
ALTER TABLE `launch_tokens` ADD COLUMN `port_slot_id` INT DEFAULT NULL AFTER `slot_id`;
ALTER TABLE `launch_tokens` ADD COLUMN `question_id` VARCHAR(20) DEFAULT NULL AFTER `port_slot_id`;

-- Make slot_id nullable for backward compatibility
ALTER TABLE `launch_tokens` MODIFY COLUMN `slot_id` INT DEFAULT NULL;

-- 7. Seed a default business for existing client
INSERT INTO `businesses` (`business_name`, `business_code`, `description`, `subscription_limit`, `subscription_used`)
VALUES ('AON', 'AON', 'AON Assessment Services', 10000, 0);

-- Link existing client to the AON business
UPDATE `clients` SET `business_id` = (SELECT business_id FROM businesses WHERE business_code = 'AON' LIMIT 1) WHERE client_id = 1;

-- 8. Migrate existing client_assignments (slot-based) to client_questions
-- From client_assignments, get the question_ids of assigned slots and insert into client_questions
INSERT IGNORE INTO `client_questions` (`client_id`, `question_id`)
SELECT DISTINCT ca.client_id, cps.question_id
FROM `client_assignments` ca
INNER JOIN `candidate_port_slots` cps ON cps.id = ca.slot_id
WHERE ca.is_active = 1;

-- ============================================================
-- MIGRATION: Restructure log_master + Add error_log table
-- ============================================================

-- 9. Restructure log_master with new 7-code activity scheme
TRUNCATE TABLE `log_master`;
INSERT INTO `log_master` (`activity_code`, `activity`) VALUES
  (1, 'Created Test Link'),
  (2, 'Acknowledged and Proceeded'),
  (3, 'Docker Container Created'),
  (4, 'Started the Assessment'),
  (5, 'Run Assessment Clicked'),
  (6, 'Submitted the Assessment'),
  (7, 'Docker Container Killed');

-- 10. CREATE error_log TABLE to capture runtime errors from link creation to submission
CREATE TABLE IF NOT EXISTS `error_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `aon_id` VARCHAR(100) NOT NULL,
  `error_stage` VARCHAR(100) NOT NULL,
  `error_message` TEXT NOT NULL,
  `error_detail` TEXT DEFAULT NULL,
  `occurred_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_error_aon_id` (`aon_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
