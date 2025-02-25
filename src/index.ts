import express from 'express';
import { getDb, initializeDatabase } from './db';
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { LLMChain } from "langchain/chains";
import { ChatPromptTemplate, PromptTemplate } from "@langchain/core/prompts";
import dotenv from 'dotenv';
import { createSqlQueryChain } from "langchain/dist/chains/sql_db";
import { GoogleGenerativeAI } from "@google/generative-ai";

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


// Initialize Langchain (do this ONCE when your app starts)
const llm = new ChatGoogleGenerativeAI({ // Correct instantiation for Gemini
  apiKey: process.env.GEMINI_API_KEY, // Use 'apiKey' instead of 'geminiApiKey'
  modelName: "gemini-pro", // Or "gemini-ultra" for the latest and most capable model if you have access
  temperature: 0.7
});
const template = "What is a good name for a company that makes {product}?";
const prompt = new PromptTemplate({ template: template, inputVariables: ["product"] });
const chain = new LLMChain({ llm: llm, prompt: prompt });

// Example test route.
app.get('/example', async (req, res) => {
  try {
    const response = await chain.call({ product: "widgets" });
    res.json({ message: response });
  } catch (error) {
    console.error("Error processing Langchain request:", error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Example2 route - queries the db for the last exerciseRep
app.get('/example2', async (req, res) => {
  try {
    const db = await getDb();
    // Langchain prompt to generate SQL query
    const sqlPromptTemplate = `
      Generate a SQL query to fetch the last record from the "exerciseReps" table.
      Make sure to order the results by the "id" column in descending order and limit to 1 result to get the last entry.
      Return only the SQL query, do not include any explanations or other text.
      SQL dialect: SQLite
      Do not include any backtics in the output, just the query.
    `;
    const prompt = new PromptTemplate({ template: sqlPromptTemplate, inputVariables: [] }); // No input variables needed
    const chain = new LLMChain({ llm: llm, prompt: prompt });
    const llmSqlquery = await chain.run({}); // Generate the SQL query using Langchain
    if (!llmSqlquery) {
      return res.status(500).json({ error: 'Failed to generate SQL query using Langchain' });
    }
    console.log("DEBUG1: Generated SQL query:", llmSqlquery);

    // Add type.
    const lastExerciseRep = await db.get(llmSqlquery); // Execute the generated SQL query

    res.json({ message: lastExerciseRep ? lastExerciseRep : 'No exercise reps found', generatedSqlQuery: llmSqlquery }); // Return the result and the generated query
  } catch (error) {
    console.error("Error fetching last exerciseRep:", error);
    res.status(500).json({ error: 'Failed to fetch last exerciseRep from database' });
  }
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

// Sample for LLM.
app.get('/example', async (req, res) => {
  try {
    const response = await chain.call({ product: "widgets" });
    res.json({ message: response });
  } catch (error) {
    console.error("Error processing Langchain request:", error);
    res.status(500).json({ error: 'Failed to process request' });
  }
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


// Serve the Calendar file.
app.get('/exerciseReps', async (req, res) => {
  // Get a list of days and data for this current month.

  // hardcoded for now.
  req.query.username = "james";
  const username = req.query.username as string;
  const month = new Date().getMonth() + 1;
  const year = new Date().getFullYear();
  const data = await getExerciseMonthData(username, month, year);

  // Pass our data set to html frontend.
  res.render('calendar', { username, month, year, days: data });
});

// Serve the exerciseRepsForm1.html file
app.get('/exerciseReps', (req, res) => {
  res.sendFile(__dirname + '/public/exerciseRepsForm1.html');
});

app.get('/exerciseReps3', (req, res) => {
  res.sendFile(__dirname + '/public/exerciseRepsForm3.html');
});

app.post('/exerciseReps1', async (req, res) => {
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

// LangChain insert version.
app.post('/exerciseReps2', async (req, res) => {
  const { userName, exerciseName, quantity, timeDone } = req.body;
  console.log("DEBUG1: Received request:", req.body);
  console.log("DEBUG2: userName", userName);
  try {
    const db = await getDb();

    // TODO: Possibly look at the table first, then auto do this?

    // // Langchain prompt to generate SQL query
    const sqlPromptTemplate = `
      Generate a SQL query to insert a new record into the "exerciseReps" table.
      The columns are "userName", "exerciseName", "quantity", and "timeDone".
      Use the provided values for each column.
      {userName}, {exerciseName}, {quantity}, {timeDone}
      Return only the SQL query, do not include any explanations or other text.
      SQL dialect: SQLite
      Do not include any backticks in the output, and no prefix, just the query.
    `;
    // const prompt = new PromptTemplate({
    //   template: sqlPromptTemplate,
    //   inputVariables: ["userName", "exerciseName", "quantity", "timeDone"]
    // });
    //
    // const chain = new LLMChain({ llm: llm, prompt: prompt });
    // // const llmSqlQuery = await chain.run({ userName, exerciseName, quantity, timeDone });
    // const llmSqlQuery = await chain.call({ userName, exerciseName, quantity, timeDone }); // Generate the SQL query using Langchain

    // Define the prompt template.
    const prompt = ChatPromptTemplate.fromTemplate(sqlPromptTemplate);

    // Create the chain by piping the prompt to the language model.
    const chain = prompt.pipe(llm);

    // Invoke the chain with the input variables
    const response = await chain.invoke({ userName, exerciseName, quantity, timeDone });
    console.log(response);
    const llmSqlQuery = response;
    if (!llmSqlQuery) {
      return res.status(500).json({ error: 'Failed to generate SQL query using Langchain' });
    }
    console.log("DEBUG3: Generated SQL query:", llmSqlQuery);
    // [1]   text: "INSERT INTO exerciseReps (userName, exerciseName, quantity, timeDone) VALUES ('John', 'Push-ups', 10, '2023-03-08 18:30:00');"

    // TODO pull out inner field earlier
    const result = await db.run(llmSqlQuery.text); // Execute the generated SQL query

    res.status(201).json({ id: result.lastID, message: 'Exercise record created' });
  } catch (error) {
    console.error("Error inserting exercise record:", error);
    res.status(500).json({ error: 'Failed to create exercise record' });
  }
});

// Gemini Tool insert version.
app.post('/exerciseReps3', async (req, res) => {
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

// Insert a new exercise repetition using Gemini 2.0 Functions.
async function insertExerciseRepGemini(userName: string, exerciseText: string) {
  console.log("DEBUG2: userName", userName);
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  console.log("DEBUG3: GoogleGenerativeAI imported");
  // Access your API key as an environment variable (see "Set up your API key" above)
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // STEP 1: Declare our functions inside our model now.
  const generativeModel = genAI.getGenerativeModel({
    // Use a model that supports function calling, like a Gemini 1.5 model
    model: "gemini-2.0-flash",
    // Specify the function declaration.
    tools: {
      functionDeclarations: [insertExerciseRepFunctionDeclaration,
        controlLightFunctionDeclaration],
    },
  });
  console.log("DEBUG4: generativeModel created");

  // STEP 2: Start our chat and check to call our function.
  console.log("DEBUG4: STEP 2: Starting chat. ");
  const chat = generativeModel.startChat();
  // const prompt = "Dim the lights so the room feels cozy and warm.";
  // const prompt = `Username is Robin. Today is ${ new Date().toISOString() }  I just completed 30 mins swimming.`;
  const prompt = `Username is ${userName}. Today is ${new Date().toISOString()}  Exercise Text: ${exerciseText}`;
  console.log("DEBUG4: Generated prompt:", prompt);
  // Send the message to the model.
  const result = await chat.sendMessage(prompt);
  console.log("DEBUG4: Received response:", result.response.text());

  // STEP 3: Call function if needed.
  console.log("DEBUG4: STEP 3: Call function if needed.");
  // For simplicity, this uses the first function call found.
  const call = result.response.functionCalls()[0];
  if (call) {
    console.log("DEBUG4: Received function call:", call);
    // Call the executable function named in the function call
    // with the arguments specified in the function call.
    // @ts-ignore
    const apiResponse = await functions[call.name](call.args);

    // STEP 4: Send the API response back to the model so it can generate
    // a text response that can be displayed to the user.
    const result2 = await chat.sendMessage([{
      // functionResponse: {
      //   name: 'controlLight',
      //   response: apiResponse
      // }
      functionResponse: {
        name: 'insertExerciseRep',
        response: apiResponse
      }
    }]);
    // Log the text response.
    const responseText = result2.response.text();
    console.log("DEBUG4: Response text:", responseText);
    return responseText;
  } else {
    console.log("DEBUG4: No function call found. exiting.");
    // else error.
    throw new Error("No function call found in response.");
  }
}


// Grab all exercise data for the month and prep for display.
async function getExerciseMonthData(userName: string, month: number, year: number) {
  // STEP 1: Build up a month of days.
  const days = new Array(31).fill(0).map((_, i) => i + 1);
  // Get the day of week for each day map into our data.
  const dayOfWeek = days.map(day => new Date(year, month, day).getDay());

  // Pad front with number of days until start day.
  const startDay = dayOfWeek[0];
  const daysToPad = new Array(startDay).fill(0);
  const paddedDays = [...daysToPad, ...days];

  // STEP 2: Query to get all data for month.
  const db = await getDb();
  const sql = 'SELECT * FROM exerciseReps WHERE userName=? AND timeDone BETWEEN ? AND ?';
  // Add params but pad any month with zero here.
  const params = [userName, `${year}-${month.toString().padStart(2, '0')}-01`, `${year}-${month.toString().padStart(2, '0')}-31`];
  const exerciseReps = await db.all(sql, params);
  const fullQuery = sql.replace(/\?/g, () => JSON.stringify(params.shift()));
  console.log("DEBUG5: fullQuery =", fullQuery);

  console.log("DEBUG4: exerciseReps", exerciseReps);

  // STEP 3: Loop and match exercise to each date now.
  const data = paddedDays.map((day, index) => {
    if (day === 0) {
      return { day, reps: [] };
    }
    const currMonth = new Date().getMonth();
    const currYear = new Date().getFullYear();
    const date = new Date(currYear, currMonth, day);
    const dateString = date.toISOString().split('T')[0];
    // console.log("DEBUG4: dateString", dateString);
    const reps = exerciseReps.filter(rep => rep.timeDone.split('T')[0] === dateString);
    return { day, reps };
  });
  // console.log("DEBUG4: data", data);

  return data;
}


// Executable function code. Put it in a map keyed by the function name
// so that you can call it once you get the name string from the model.
const functions = {
  controlLight: ({ brightness, colorTemperature }: { brightness: number, colorTemperature: string }) => {
    return setLightValues(brightness, colorTemperature)
  },
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
const controlLightFunctionDeclaration = {
  name: "controlLight",
  parameters: {
    type: "OBJECT",
    description: "Set the brightness and color temperature of a room light.",
    properties: {
      brightness: {
        type: "NUMBER",
        description: "Light level from 0 to 100. Zero is off and 100 is full brightness.",
      },
      colorTemperature: {
        type: "STRING",
        description: "Color temperature of the light fixture which can be `daylight`, `cool` or `warm`.",
      },
    },
    required: ["brightness", "colorTemperature"],
  },
};

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