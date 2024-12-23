const express = require('express');
const bodyParser = require('body-parser');
const { SerialPort, ReadlineParser } = require('serialport');
const { list } = require('serialport');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const app = express();
app.use(bodyParser.json());

// Swagger Configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'GSM API',
      version: '1.0.0',
      description: 'API for interacting with GSM Modems',
    },
    servers: [{ url: 'http://localhost:3000' }],
  },
  apis: ['./app.js'], // Points to this file for Swagger doc annotations
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

/**
 * @swagger
 * /:
 *   get:
 *     summary: Check if the API is running
 *     responses:
 *       200:
 *         description: Returns a success message.
 */
app.get('/', (req, res) => {
  res.json({ message: 'GSM API is running!' });
});

/**
 * @swagger
 * /ports:
 *   get:
 *     summary: List available COM ports
 *     responses:
 *       200:
 *         description: A list of available COM ports.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ports:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       port:
 *                         type: string
 *                       description:
 *                         type: string
 */
app.get('/ports', async (req, res) => {
  try {
    const ports = await SerialPort.list(); // Fetch available ports
    const portList = ports
        .filter((port) => port.path !== 'COM1') // Exclude COM1
        .map((port) => ({
          port: port.path,
          description: port.manufacturer || 'Unknown device',
        }))
        .sort((a, b) => {
          // Extract numerical part of the port names and sort in descending order
          const portNumberA = parseInt(a.port.replace(/\D/g, ''), 10) || 0;
          const portNumberB = parseInt(b.port.replace(/\D/g, ''), 10) || 0;
          return portNumberB - portNumberA;
        });
    res.json({ ports: portList });
  } catch (error) {
    res.status(500).json({ error: `Error listing ports: ${error.message}` });
  }
});




/**
 * @swagger
 * /get-info:
 *   post:
 *     summary: Fetch GSM modem information
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               port:
 *                 type: string
 *                 description: The COM port to connect to
 *     responses:
 *       200:
 *         description: GSM modem details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 port:
 *                   type: string
 *                 phone_number:
 *                   type: string
 *                 balance:
 *                   type: string
 *                 raw_response:
 *                   type: string
 *       500:
 *         description: Error fetching modem information.
 */
app.post('/get-info', async (req, res) => {
  const { port } = req.body;
  try {
    const serial = new SerialPort({ path: port, baudRate: 115200 });
    const parser = new ReadlineParser();
    serial.pipe(parser);

    // Send AT command
    serial.write('AT\r');
    let response = await readFromSerial(parser, 1000);
    if (!response.includes('OK')) {
      serial.close();
      return res.status(400).json({ error: 'Device not responding.' });
    }

    // Send USSD command (*101#)
    serial.write('ATD*101#;\r');
    const ussdResponse = await readFromSerial(parser, 3000);
    const { phoneNumber, balance } = extractPhoneAndBalance(ussdResponse);

    serial.close();
    res.json({
      port,
      phone_number: phoneNumber || 'Unknown',
      balance: balance || 'Unknown',
      raw_response: ussdResponse,
    });
  } catch (error) {
    res.status(500).json({ error: `Error fetching info from port ${port}: ${error.message}` });
  }
});

// Helper to read from serial
function readFromSerial(parser, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      parser.removeAllListeners();
      reject(new Error('Timeout reading from serial port.'));
    }, timeout);

    parser.once('data', (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });
}

// Helper to extract phone number and balance
function extractPhoneAndBalance(response) {
  const phoneRegex = /\b\d{10,11}\b/;
  const balanceRegex = /TKC:?\s?([\w\d]+)/;

  const phoneNumber = response.match(phoneRegex)?.[0] || null;
  const balance = response.match(balanceRegex)?.[1] || null;

  return { phoneNumber, balance };
}

// Start server
const PORT = 3333;
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`API documentation available at http://localhost:${PORT}/api-docs`);
});
