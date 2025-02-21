import express from 'express';
import { getDb, initializeDatabase } from './db'; // Import from db.ts

const app = express();
const port = 3069;

app.use(express.json());

app.use(express.static(__dirname + '/public')); // Serve static files from the 'public' directory


// Initialize the database before starting the server
initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
});

// Home Route (Default / Main Page) - This is what you were asking for
app.get('/', (req, res) => {
  // Option 1: Send a simple string
  // res.send('<h1>Welcome to the Home Page!</h1>');

  // Option 2: Send an HTML file (more common)
  res.sendFile(__dirname + '/public/index.html'); // Assuming you have an index.html in a 'public' folder

  // Option 3: Send JSON data (if it's an API)
  // res.json({ message: 'Welcome to the API!' });
});

app.get('/users', async (req, res) => {
  try {
    const db = await getDb();
    const users = await db.all('SELECT * FROM users'); // Use db.all for SELECT queries
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/users', async (req, res) => {
  const { name, email } = req.body;
  try {
    const db = await getDb();
    const result = await db.run('INSERT INTO users (name, email) VALUES (?, ?)', [name, email]);
    res.status(201).json({ id: result.lastID, message: 'User created' });
  } catch (error) {
    console.error("Error inserting user:", error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.post('/exerciseReps', async (req, res) => {
  const { userName, exerciseName, quantity, timeDone } = req.body;
  try {
    const db = await getDb();
    const result = await db.run(
      'INSERT INTO exerciseReps (userName, exerciseName, quantity, timeDone) VALUES (?, ?, ?, ?)',
      [userName, exerciseName, quantity, timeDone]
    );
    res.status(201).json({ id: result.lastID, message: 'Exercise record created' });
  } catch (error) {
    console.error("Error inserting exercise record:", error);
    res.status(500).json({ error: 'Failed to create exercise record' });
  }
});
