import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (db) {
    return db;
  }

  db = await open({
    filename: './mydb.sqlite',
    driver: sqlite3.Database
  });

  return db;
}

async function createUsersTable() {
  const db = await getDb();
  try {
    await db.exec(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE
          )
        `);
    console.log("Users table created or already exists.");
  } catch (error) {
    console.error("Error creating Users table:", error);
    throw error;
  }
}

async function createExerciseRepsTable() {
  const db = await getDb();
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS exerciseReps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userName TEXT NOT NULL,
        exerciseName TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        timeDone TEXT NOT NULL
      )
    `);
    console.log("ExerciseReps table created or already exists.");
  } catch (error) {
    console.error("Error creating ExerciseReps table:", error);
    throw error;
  }
}

async function initializeDatabase() {
  try {
    await createUsersTable(); // Initialize users table first
    await createExerciseRepsTable();
    console.log("Database initialized successfully.");
  } catch (error) {
    console.error("Database initialization failed:", error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  if (db) {
    await db.close();
    console.log('Database connection closed');
  }
  process.exit(0);
});

export { getDb, initializeDatabase }; // Export the functions