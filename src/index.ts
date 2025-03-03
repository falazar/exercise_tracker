import express from 'express';
import { getDb, initializeDatabase } from './db';
import dotenv from 'dotenv';
// import { GoogleGenerativeAI } from "@google/generative-ai";
const nodemailer = require('nodemailer');
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const app = express();
const port = 3069;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname + '/public')); // Serve static files from the 'public' directory
// Initialize the database before starting the server
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

initializeDatabase().then(async () => {
  // const langChain = await initializeLangChain();
  // app.locals.langChain = langChain;

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

// Test simple form
app.get('/exerciseReps3', (req, res) => {
  res.sendFile(__dirname + '/public/exerciseRepsForm.html');
});


// Serve the Calendar file.
app.get('/exerciseReps', async (req, res) => {
  // Get the username from query parameters or default to "james"
  const username = (req.query.username || "james") as string;

  // Get the month and year from query parameters or default to the current month and year
  const month = req.query.month ? parseInt(req.query.month as string, 10) : new Date().getMonth() + 1;
  const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear();

  // Get a list of days and data for the specified month and year
  const data = await getExerciseMonthData(username, month, year);

  // Render the calendar view with the data
  res.render('calendar', { username, month, year, days: data });
});

// Gemini Tool insert exercise rep.
app.post('/exerciseReps', async (req, res) => {
  console.log("DEBUG1: Gemini Tool insert version");
  // console.log("DEBUG1: Received request:", req.body);
  const { username, exerciseText } = req.body;

  try {
    const response = await insertExerciseRepGemini(username, exerciseText);
    res.status(201).json({ message: response });
  } catch (error) {
    console.error("Error inserting exercise record:", error);
    res.status(500).json({ error: 'Failed to create exercise record' });
  }
});

// Sample for SMS sending.
app.get('/exampleSMS', async (req, res) => {
  try {
    // const response = await chain.call({ product: "widgets" });
    const response = await sendSMS('5127092825', 'Hello World falazar 3 via email.');

    res.json({ message: 'ok' });
  } catch (error) {
    console.error("Error processing SMS request:", error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Grab all exercise data for the month and prep for display.
async function getExerciseMonthData(username: string, month: number, year: number) {
  console.log("getExerciseMonthData: month year = ", month, year);

  // STEP 1: Get start and end dates that show on a calendar page.
  const startDay = new Date(year, month - 1, 1).getDay();
  const startDate = new Date(year, month - 1, 1 - startDay);
  const daysInMonth = new Date(year, month, 0).getDate();
  const endDay = new Date(year, month, 0).getDay();
  const endDate = new Date(year, month - 1, daysInMonth + (6 - endDay));
  console.log("DEBUG4: startDate", startDate);
  console.log("DEBUG4: endDate", endDate);

  // STEP 3: Query to get all done reps data for month.
  const db = await getDb(); // TODO move up out.
  const sql = 'SELECT * FROM exerciseReps WHERE userName=? AND timeDone BETWEEN ? AND ? order by exerciseName';
  const params = [username, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]];
  const exerciseReps = await db.all(sql, params);

  // STEP 4: Query to get all planned reps data for month.
  const sql2 = 'SELECT * FROM exerciseRepsPlanned WHERE username=? AND datePlanned BETWEEN ? AND ? order by exerciseName';
  const params2 = [username, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]];
  const exerciseRepsPlanned = await db.all(sql2, params2);

  // STEP 5: Loop and match exercise to each date now.
  // Create an array of dates from startDate to endDate
  const dateArray = [];
  let currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    dateArray.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }
  // Map over every day from startDate to endDate
  const data = dateArray.map((date) => {
    const {
      reps,
      repsPlanned,
      completedPlanned,
      completedDaily
    } = filterForDate(date, exerciseReps, exerciseRepsPlanned);

    return { date, reps, repsPlanned, completedPlanned, completedDaily };
  });
  // console.log("DEBUG6: data", data);

  return data;
}

// Given two sets of data, filter out just what we need for this date.
// function filterForDate(exerciseReps: any[], exerciseRepsPlanned: any[], year: number, month: number, day: number) {
function filterForDate(date: Date, exerciseReps: any[], exerciseRepsPlanned: any[]) {
  // Day can be negative to pad front and over month to pad end.
  // const date = new Date(year, month - 1, day);
  const dateString = date.toISOString().split('T')[0];
  // console.log("\nDEBUG4: dateString", dateString);

  // STEP 1: Filter reps for this date and make hash.
  const reps = exerciseReps.filter(rep => rep.timeDone.split('T')[0] === dateString);
  // TODO make method.
  // Make a temp hash of exerciseName to quantity.
  const exerciseHash = reps.reduce((hash, { exerciseName, quantity }) => {
    hash[exerciseName] = (hash[exerciseName] || 0) + quantity;
    return hash;
  }, {});

  // STEP 2: Filter planned reps for this date and make hash.
  const repsPlanned = exerciseRepsPlanned.filter(rep => rep.datePlanned === dateString);
  const plannedExerciseHash = repsPlanned.reduce((hash, { exerciseName, quantity }) => {
    hash[exerciseName] = (hash[exerciseName] || 0) + quantity;
    return hash;
  }, {});
  // console.log("DEBUG7: exerciseHash", exerciseHash);
  // console.log("DEBUG7: plannedExerciseHash", plannedExerciseHash);

  // STEP 3: For every planned rep, subtract out the total reps done and see if goal achieved.
  const completedPlanned = Object.keys(plannedExerciseHash).map(exerciseName => {
    const plannedQuantity = plannedExerciseHash[exerciseName] || 0;
    const doneQuantity = exerciseHash[exerciseName] || 0;
    const completed = plannedQuantity - doneQuantity <= 0;
    return { exerciseName, plannedQuantity, doneQuantity, remaining: plannedQuantity - doneQuantity, completed };
  });
  // console.log("DEBUG8: completedPlanned", completedPlanned);

  // STEP 4: If we had any scheduled reps and all are done, then we completed the daily goal.
  let completedDaily = undefined;
  if (Object.keys(plannedExerciseHash).length > 0) {
    completedDaily = !completedPlanned.some(({ remaining }) => remaining > 0);
  }
  // console.log("DEBUG8: completedDaily=", completedDaily);

  // STEP 5: For each planned rep, see if it is completed yet.
  const exerciseHashTemp = { ...exerciseHash };
  repsPlanned.forEach(rep => {
    rep.completed = exerciseHashTemp[rep.exerciseName] >= rep.quantity;
    exerciseHashTemp[rep.exerciseName] -= rep.quantity;
  });
  console.log("DEBUG8: repsPlanned", repsPlanned);

  // TODO Probably display only totals.

  return { reps, repsPlanned, completedPlanned, completedDaily };
}


// Insert a new exercise repetition using Gemini 2.0 Functions.
async function insertExerciseRepGemini(username: string, exerciseText: string) {
  console.log("DEBUG3: GoogleGenerativeAI imported");
  // Access your API key as an environment variable (see "Set up your API key" above)
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // STEP 1: Declare our functions inside our model now.
  const generativeModel = genAI.getGenerativeModel({
    // Use a model that supports function calling, like a Gemini 1.5 model
    model: "gemini-2.0-flash",
    // Specify the function declaration.
    tools: {
      functionDeclarations: [insertExerciseRepFunctionDeclaration],
    },
  });
  console.log("DEBUG4: generativeModel created");

  // STEP 2: Start our chat and check to call our function.
  console.log("DEBUG4: STEP 2: Starting chat. ");
  const chat = generativeModel.startChat();
  // const prompt = `Username is Robin. Today is ${ new Date().toISOString() }  I just completed 30 mins swimming.`;
  // Build up the full prompt we send to gemini. This is the input to the model.
  const prompt = `Username is ${username}. Today is ${new Date().toISOString()}  Exercise Text: ${exerciseText}`;
  console.log("DEBUG4: Generated prompt:", prompt);
  // Send the message to the model.
  const result = await chat.sendMessage(prompt);
  console.log("DEBUG4: Received response:", result.response.text());

  // STEP 3: Call function if needed.
  console.log("DEBUG5: STEP 3: Call function if needed.");
  // For simplicity, this uses the first function call found.
  const call = result.response.functionCalls()[0];
  if (call) {
    console.log("DEBUG5: Received function call:", call);
    // Call the executable function named in the function call
    // with the arguments specified in the function call.
    // @ts-ignore
    const apiResponse = await functions[call.name](call.args);

    // STEP 4: Send the API response back to the model so it can generate
    // a text response that can be displayed to the user.
    const result2 = await chat.sendMessage([{
      functionResponse: {
        name: 'insertExerciseRep',
        response: apiResponse
      }
    }]);
    // Log the text response.
    const responseText = result2.response.text();
    console.log("DEBUG6: Response text:", responseText);
    return responseText;
  } else {
    console.log("DEBUG6: No function call found. exiting.");
    // else error.
    throw new Error("No function call found in response.");
  }
}

// Executable function code. Put it in a map keyed by the function name
// so that you can call it once you get the name string from the model.
const functions = {
  insertExerciseRep: ({ username, exerciseName, quantity, quantityType, timeDone }: {
    username: string,
    exerciseName: string,
    quantity: number,
    quantityType: string,
    timeDone: string
  }) => {
    return insertExerciseRep(username, exerciseName, quantity, quantityType, timeDone);
  }
};

// Declare our methods here with some helpful descriptions.
const insertExerciseRepFunctionDeclaration = {
  name: "insertExerciseRep",
  parameters: {
    type: "OBJECT",
    description: "Insert an exercise repetition record into the database.",
    properties: {
      username: {
        type: "STRING",
        description: "The name of the user performing the exercise.",
      },
      exerciseName: {
        type: "STRING",
        description: "The name of the exercise being performed.",
      },
      quantity: {
        type: "NUMBER",
        description: "The number of repetitions performed, repetitions or minutes, if hours convert to minutes.",
      },
      quantityType: {
        type: "STRING",
        description: "The type for the quantity, generally either 'reps' or 'minutes' or 'laps' or 'miles'. ",
      },
      timeDone: {
        type: "STRING",
        description: "The time when the exercise was performed. Date and time format. If no date given, use today, if no time given use current time. ",
      },
    },
    required: ["username", "exerciseName", "quantity", "timeDone"],
  },
}

async function insertExerciseRep(username: string, exerciseName: string, quantity: number, quantityType: string, timeDone: string) {
  const db = await getDb();
  const result = await db.run(
    'INSERT INTO exerciseReps (userName, exerciseName, quantity, quantityType, timeDone) VALUES (?, ?, ?, ?, ?)',
    [username, exerciseName, quantity, quantityType, timeDone]
  );
  console.log('SQL Exercise record created.');
}


// Example for SMS sending.
async function sendSMS(toNumber: string, message: string) {
  // Create a transporter object using SMTP transport
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'falazar23@gmail.com',
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });

  // Define the email options
  const mailOptions = {
    from: 'falazar23@gmail.com',
    to: '5127092825@tmomail.net',
    // to: `${toNumber}@tmomail.net`,
    subject: 'Workout Reminder3',
    // text: 'This is a test message sent to a Sprint phone number via email.',
    text: message
  };

  // Send the message
  transporter.sendMail(mailOptions, (error: any, info: { response: string; }) => {
    if (error) {
      return console.log(error);
    }
    console.log('SMS Message sent: ' + info.response);
  });

  return true;
}


/*
[1] DEBUG1: Received request: {
[1]   username: 'james',
[1]   exerciseName: 'pushups',
[1]   quantity: '50',
[1]   timeDone: '2025-02-21T16:46'
[1] }
[1] DEBUG1: Generated SQL query: {
[1]   text: "INSERT INTO exerciseReps(userName, exerciseName, quantity, timeDone) VALUES ('John', 'Push-ups', 10, '2023-02-15 17:30:00');"
[1] }
[1] Error inserting exercise record: TypeError: undefined is not iterable (cannot read property Symbol(Symbol.iterator))

 */