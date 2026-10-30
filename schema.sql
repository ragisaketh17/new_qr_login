-- ==============================================================
-- QR Loyalty Rewards Application - Database Schema
-- Compatible with XAMPP MySQL / MariaDB & phpMyAdmin
-- ==============================================================

-- 1. Create Database if it does not already exist
CREATE DATABASE IF NOT EXISTS `mart_loyalty`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `mart_loyalty`;

-- --------------------------------------------------------------
-- 2. Users Table
-- Stores registered customer emails, visit counts, and timestamps
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(254) NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `visitCount` INT NOT NULL DEFAULT 0,
  `lastVisitAt` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- 3. Sessions Table
-- Stores user authentication sessions mapped to user IDs
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tokenHash` CHAR(64) NOT NULL,
  `userId` BIGINT UNSIGNED NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sessions_tokenHash` (`tokenHash`),
  KEY `idx_sessions_userId` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- 4. Claims Table
-- Tracks reward coupons claimed by users (one claim per offer tier)
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `claims` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `minVisits` INT NOT NULL,
  `claimedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_claim_user_reward` (`userId`, `minVisits`),
  KEY `idx_claims_userId` (`userId`),
  KEY `idx_claims_claimedAt` (`claimedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- 5. Visits Table
-- Logs each individual QR code visit with timestamp
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `visits` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_visits_userId` (`userId`),
  KEY `idx_visits_at` (`at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- 6. Settings Table
-- Stores app configurations (custom offers, links, Google reviews cache)
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `settings` (
  `settingKey` VARCHAR(100) NOT NULL,
  `settingValue` LONGTEXT NULL,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`settingKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------
-- 7. Reviews Table
-- Caches synced Google reviews
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `reviews` (
  `id` VARCHAR(255) NOT NULL,
  `author` VARCHAR(255) NOT NULL,
  `authorUrl` TEXT NULL,
  `stars` DECIMAL(3,1) NULL,
  `text` TEXT NULL,
  `publishedAt` DATETIME NULL,
  `syncedAt` DATETIME NULL,
  `firstSeenAt` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_reviews_publishedAt` (`publishedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

