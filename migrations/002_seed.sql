-- Seed data for development/testing
-- Creates a default admin user (password: changeme123)
-- In production, change this password immediately!

INSERT INTO admin_users (email, name, password_hash, role) VALUES
('admin@alnmouthvillage.golf', 'Admin User', '$2a$10$xJwL5vV5X5X5X5X5X5X5XuYZaYZaYZaYZaYZaYZaYZaYZaYZaYZaY', 'admin');

-- Note: The password hash above is a placeholder.
-- The actual app uses a simple hash comparison for the demo.
-- For production, implement proper bcrypt hashing.
