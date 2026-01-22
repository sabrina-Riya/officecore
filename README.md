# OfficeCore – Role-Based Leave Management System

## Description
OfficeCore is a **role-based employee leave management system** built using **Node.js, Express.js, PostgreSQL, and Passport.js**.  
The system automates and manages employee leave workflows within an organization, providing **separate dashboards and permissions for Admins and Employees**.

Employees can apply for leave and track their application status, while administrators can review, approve, or reject leave requests through a secure interface.  
This project emphasizes **backend system design, authentication & authorization, session management, and relational database integrity**, simulating a real-world internal enterprise application.

---

## Key Features

### Employee Features
- Secure login with session-based authentication  
- Personalized dashboard displaying leave summary  
- Apply for leave with start date, end date, and reason  
- View leave request history and status (**Pending, Approved, Rejected**)  

### Admin Features
- Secure admin-only dashboard  
- Overview of total employees and leave statistics  
- Review, approve, or reject leave requests  
- Manage users and monitor system activity  

### System-Level Features
- Role-Based Access Control (**RBAC**) for Admin and Employee roles  
- Secure password hashing using **bcrypt**  
- Protected routes using Express middleware  
- Flash messages for success and error feedback  
- Session-based authentication using **Passport.js**  

---

## Tech Stack
- **Backend:** Node.js, Express.js  
- **Database:** PostgreSQL  
- **Authentication:** Passport.js (Local Strategy)  
- **Authorization:** Role-Based Access Control (RBAC)  
- **Templating Engine:** EJS  
- **Security:** bcrypt for password hashing, parameterized SQL queries  
- **Session Management:** express-session  
- **User Feedback:** express-flash  
- **Tools:** Git, GitHub, Postman  

---

## Application Architecture Overview
OfficeCore follows a **route-based architecture with modular middleware**, commonly used in small-to-medium Node.js applications.

- **Routes & Business Logic:** Handled directly in Express route handlers (`app.js`) for request handling, validation, and database interactions  
- **Middleware Layer:** Authentication, role-based authorization, session management, and flash messaging are modularized in separate middleware files  
- **Views:** EJS templates render dynamic dashboards and forms for Admin and Employee roles  
- **Database Layer:** PostgreSQL with relational schema and foreign key constraints to maintain data integrity  
- **Authentication Layer:** Passport.js manages login, session persistence, serialization, and deserialization  
- **Authorization Layer:** Custom middleware enforces access control based on user roles  

This structure prioritizes **clarity, security, and maintainability**, while remaining flexible enough to evolve into a fully separated MVC architecture if needed.

---

## Database Design

### Users Table
- Stores user credentials and role information  
- Role determines access level (**admin, employee**)  

### Leave Table
- Stores leave applications linked to users via foreign keys  
- Tracks leave duration, reason, status, and timestamps  
- Relational integrity enforced via foreign key relationships  

---

## Authentication & Authorization Flow
1. User submits login credentials  
2. Passport.js verifies credentials using the **Local Strategy**  
3. Passwords are compared using **bcrypt**  
4. On success, user ID is stored in session  
5. User is deserialized on subsequent requests  

**Custom middleware checks:**  
- Authentication status  
- Role-based permissions before accessing routes  

This ensures **secure access control across the system**.

---

## Installation
```bash
# Clone the repository
git clone https://github.com/sabrina-Riya/officecore.git

# Navigate into project directory
cd officecore

# Install dependencies
npm install

# Create .env file with your DB credentials

# Run the application
npm start
