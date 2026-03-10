-- Add password reset token fields to users table
ALTER TABLE `users`
  ADD COLUMN `resetToken` VARCHAR(100) NULL,
  ADD COLUMN `resetTokenExpiresAt` DATETIME(3) NULL,
  ADD UNIQUE INDEX `users_resetToken_key` (`resetToken`);
