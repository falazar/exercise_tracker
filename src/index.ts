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
  const { userName, exerciseText } = req.body;

  try {
    const response = await insertExerciseRepGemini(userName, exerciseText);
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

// Insert a new exercise repetition using Gemini 2.0 Functions.
async function insertExerciseRepGemini(userName: string, exerciseText: string) {
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
  const prompt = `Username is ${userName}. Today is ${new Date().toISOString()}  Exercise Text: ${exerciseText}`;
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

// Grab all exercise data for the month and prep for display.
async function getExerciseMonthData(userName: string, month: number, year: number) {
  // STEP 1: Build up a month of days.
  // Get amount of days in this month.
  console.log("getExerciseMonthData: month year = ", month, year);
  const daysInMonth = new Date(year, month, 0).getDate();
  console.log("DEBUG4: daysInMonth", daysInMonth);
  const days = new Array(daysInMonth).fill(0).map((_, i) => i + 1);

  // STEP 2: Pad front and end days on calendar. make method just to get dates.
  console.log("DEBUG1: Making calendar days now.");
  // Get the day of week for each day map into our data.
  const startDay = new Date(year, month-1, 1).getDay();
  console.log("DEBUG4: startDay", startDay);

  const daysToPad = Array.from({ length: startDay }, (_, i) => -startDay + i + 1);
  let paddedDays = [...daysToPad, ...days];
  // Pad end with number of days until end day.
  const endDay = new Date(year, month, 0).getDay();
  // console.log("DEBUG4: endDay", endDay);
  const daysToPadEnd = Array.from({ length: 6 - endDay }, (_, i) => i + 1 + daysInMonth);
  paddedDays = [...paddedDays, ...daysToPadEnd];
  console.log("DEBUG4: DONE paddedDays = ", paddedDays);
  const startDate = new Date(year, month-1, 1 - startDay);
  const endDate = new Date(year, month-1, daysInMonth + (6 - endDay));
  console.log("DEBUG4: startDate", startDate);
  console.log("DEBUG4: endDate", endDate);
  // todo use these instead.

  // STEP 3: Query to get all done reps data for month.
  const db = await getDb(); // TODO move up out.
  const sql = 'SELECT * FROM exerciseReps WHERE userName=? AND timeDone BETWEEN ? AND ? order by timeDone, exerciseName';
  const params = [userName, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]];
  const exerciseReps = await db.all(sql, params);
  const fullQuery = sql.replace(/\?/g, () => JSON.stringify(params.shift()));
  console.log("DEBUG5: fullQuery =", fullQuery);
  // console.log("DEBUG5: exerciseReps=", exerciseReps);

  // STEP 4: Query to get all planned reps data for month.
  const sql2 = 'SELECT * FROM exerciseRepsPlanned WHERE userName=? AND datePlanned BETWEEN ? AND ? order by datePlanned, exerciseName';
  const params2 = [userName, startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]];
  const exerciseRepsPlanned = await db.all(sql2, params2);
  const fullQuery2 = sql2.replace(/\?/g, () => JSON.stringify(params2.shift()));
  console.log("DEBUG6: fullQuery2 =", fullQuery2);
  // console.log("DEBUG6: exerciseRepsPlanned=", exerciseRepsPlanned);

  // STEP 5: Loop and match exercise to each date now.
  // console.log("DEBUG6: month", month);
  const data = paddedDays.map((day, index) => {
    // TODO MAKE METHOD????
    const date = new Date(year, month-1, day);
    const dateString = date.toISOString().split('T')[0];
    // console.log("\nDEBUG4: dateString", dateString);
    const reps = exerciseReps.filter(rep => rep.timeDone.split('T')[0] === dateString);
    const repsPlanned = exerciseRepsPlanned.filter(rep => rep.datePlanned === dateString);

    // TODO make method.
    // Make a temp hash of exerciseName to quantity.
    const exerciseHash = reps.reduce((hash, { exerciseName, quantity }) => {
      hash[exerciseName] = (hash[exerciseName] || 0) + quantity;
      return hash;
    }, {});
    const plannedExerciseHash = repsPlanned.reduce((hash, { exerciseName, quantity }) => {
      hash[exerciseName] = (hash[exerciseName] || 0) + quantity;
      return hash;
    }, {});
    // console.log("DEBUG7: exerciseHash", exerciseHash);
    // console.log("DEBUG7: plannedExerciseHash", plannedExerciseHash);

    // For every planned rep, subtract out the total reps done and see if goal achieved.
    const completedPlanned = Object.keys(plannedExerciseHash).map(exerciseName => {
      const plannedQuantity = plannedExerciseHash[exerciseName] || 0;
      const doneQuantity = exerciseHash[exerciseName] || 0;
      return { exerciseName, plannedQuantity, doneQuantity, remaining: plannedQuantity - doneQuantity };
    });
    // console.log("DEBUG8: completedPlanned", completedPlanned);
    // If we had any scheduled reps and all are done, then we completed the daily goal.
    let completedDaily = undefined;
    if (Object.keys(plannedExerciseHash).length > 0) {
      completedDaily = !completedPlanned.some(({ remaining }) => remaining > 0);
    }
    // console.log("DEBUG8: completedDaily=", completedDaily);

    return { date, reps, repsPlanned, completedPlanned, completedDaily };
  });
  // console.log("DEBUG6: data", data);

  return data;
}

// Executable function code. Put it in a map keyed by the function name
// so that you can call it once you get the name string from the model.
const functions = {
  insertExerciseRep: ({ userName, exerciseName, quantity, timeDone }: {
    userName: string,
    exerciseName: string,
    quantity: number,
    timeDone: string
  }) => {
    return insertExerciseRep(userName, exerciseName, quantity, timeDone);
  }
};

// Gemini test methods.
async function setLightValues(brightness: number, colorTemp: string) {
  // This mock API returns the requested lighting values

  console.log("DEBUG5: Setting light values: brightness =", brightness, "color temperature =", colorTemp);
  // TODO STUFFS

  return {
    brightness: brightness,
    colorTemperature: colorTemp
  };
}

async function insertExerciseRep(userName: string, exerciseName: string, quantity: number, timeDone: string) {
  const db = await getDb();
  const result = await db.run(
    'INSERT INTO exerciseReps (userName, exerciseName, quantity, timeDone) VALUES (?, ?, ?, ?)',
    [userName, exerciseName, quantity, timeDone]
  );
  console.log('SQL Exercise record created.');
}

// Declare our methods here with some helpful descriptions.
const insertExerciseRepFunctionDeclaration = {
  name: "insertExerciseRep",
  parameters: {
    type: "OBJECT",
    description: "Insert an exercise repetition record into the database.",
    properties: {
      userName: {
        type: "STRING",
        description: "The name of the user performing the exercise.",
      },
      exerciseName: {
        type: "STRING",
        description: "The name of the exercise being performed.",
      },
      quantity: {
        type: "NUMBER",
        description: "The number of repetitions performed.",
      },
      timeDone: {
        type: "STRING",
        description: "The time when the exercise was performed. Date and time format. If no date given, use today, if no time given use current time. ",
      },
    },
    required: ["userName", "exerciseName", "quantity", "timeDone"],
  },
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
[1]   userName: 'james',
[1]   exerciseName: 'pushups',
[1]   quantity: '50',
[1]   timeDone: '2025-02-21T16:46'
[1] }
[1] DEBUG1: Generated SQL query: {
[1]   text: "INSERT INTO exerciseReps(userName, exerciseName, quantity, timeDone) VALUES ('John', 'Push-ups', 10, '2023-02-15 17:30:00');"
[1] }
[1] Error inserting exercise record: TypeError: undefined is not iterable (cannot read property Symbol(Symbol.iterator))

 */