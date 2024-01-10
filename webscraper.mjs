import axios from 'axios';
import validUrl from 'valid-url';
import fs from 'fs';
import cheerio from 'cheerio';
import dns from 'dns';

class WebBot {
  constructor(url) {
    if (!this.validateUrl(url)) {
      console.error('Invalid URL. Please provide a valid URL.');
      process.exit(1);
    }

    this.url = url;
    this.headers = {
      'User-Agent': this.getRandomUserAgent(),
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    };
    this.cookies = [];
    this.logFile = 'web_bot_log.txt';
    this.errorLogFile = 'web_bot_error_log.txt';
    this.consecutiveErrors = 0;
    this.botTrafficCount = 500; // Adjust the number of bot traffic requests as needed
    this.delayBetweenRequests = 0; // Increase the delay to avoid rate limiting
    this.databaseEndpoints = [];
  }

  validateUrl(url) {
    return validUrl.isWebUri(url);
  }

  getRandomUserAgent() {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/91.0.864.59 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  async crawlAndParse() {
    try {
      // Get server information
      const serverInfo = await this.getServerInfo();
      console.log(`Server Name: ${serverInfo.serverName}`);
      console.log(`Server IP Address: ${serverInfo.ipAddress}`);

      // Use Cheerio to parse the HTML content
      const initialResponse = await axios.get(this.url, {
        headers: this.headers,
        maxRedirects: 5,
        validateStatus: status => status >= 200 && status < 400,
        http2: false,
      });

      const $ = cheerio.load(initialResponse.data);

      // Log information about all HTML elements on the page
      const allElements = this.logAllElements($);

      // Save information to a JSON file
      this.saveToJson(allElements);

      // Extract all links from the initial page
      const allLinks = [];
      $('a').each((index, element) => {
        const href = $(element).attr('href');
        if (href && validUrl.isWebUri(href)) {
          allLinks.push(href);
        }
      });

      // Process each link
      for (let i = 0; i < allLinks.length; i++) {
        const link = allLinks[i];
        try {
          // Extract port from the link
          const parsedUrl = new URL(link);
          const port = parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80);

          const response = await axios.get(link, {
            headers: this.headers,
            maxRedirects: 5,
            validateStatus: status => status >= 200 && status < 400,
            http2: false,
          });

          console.log(`Link #${i + 1} - Status Code: ${response.status}`);
          console.log(`Click to open: ${link}`);
          console.log(`Port of the IP address: ${port}`);

          // Check if the response body contains potential database endpoints
          const potentialEndpoints = this.extractDatabaseEndpoints(response.data);
          this.databaseEndpoints.push(...potentialEndpoints);
        } catch (error) {
          this.handleRequestError(`Error processing link #${i + 1}`, error);
        } finally {
          await this.delay(this.delayBetweenRequests);
        }
      }

      // Additional steps for inspecting the database
      await this.inspectDatabase();
    } catch (error) {
      this.handleRequestError('Error during the crawling and parsing process', error);
    }
  }

  async getServerInfo() {
    const urlObject = new URL(this.url);
    const hostname = urlObject.hostname;

    return new Promise((resolve, reject) => {
      dns.lookup(hostname, (err, address, family) => {
        if (err) {
          reject(err);
        } else {
          dns.reverse(address, (err, hostnames) => {
            if (err) {
              reject(err);
            } else {
              const serverInfo = {
                serverName: hostnames[0] || 'N/A',
                ipAddress: address,
              };
              resolve(serverInfo);
            }
          });
        }
      });
    });
  }

  logAllElements($) {
    const allElements = [];
    // Log information about all HTML elements
    $('*').each((index, element) => {
      const elementType = element.name;
      const elementAttributes = $(element).attr();
      allElements.push({ type: elementType, attributes: elementAttributes });
    });

    console.log('All HTML elements on the page:', allElements);
    return allElements;
  }

  saveToJson(data) {
    const jsonOutputFile = 'web_bot_output.json';

    fs.writeFile(jsonOutputFile, JSON.stringify(data, null, 2), err => {
      if (err) {
        console.error(`Error writing to JSON file: ${err.message}`);
      } else {
        console.log(`Data saved to ${jsonOutputFile}`);
      }
    });
  }

  extractDatabaseEndpoints(htmlContent) {
    const potentialEndpoints = [];
    // Implement logic to identify potential database-related endpoints in the HTML content
    // This can be based on patterns, keywords, or any specific information that indicates a database endpoint

    // Example: Looking for URLs that contain 'database' in them
    const regex = /\/database\//gi;
    let match;
    while ((match = regex.exec(htmlContent)) !== null) {
      potentialEndpoints.push(match[0]);
    }

    return potentialEndpoints;
  }

  async inspectDatabase() {
    try {
      // Iterate over discovered endpoints and attempt to fetch database information
      for (const endpoint of this.databaseEndpoints) {
        try {
          const databaseInfoResponse = await axios.get(endpoint, {
            headers: this.headers,
            maxRedirects: 5,
            validateStatus: status => status >= 200 && status < 400,
            http2: false,
          });

          // Log or process the database information
          console.log(`Database Information from endpoint ${endpoint}:`, databaseInfoResponse.data);
        } catch (error) {
          this.handleRequestError(`Error inspecting the database at endpoint ${endpoint}`, error);
        } finally {
          await this.delay(this.delayBetweenRequests);
        }
      }
    } catch (error) {
      this.handleRequestError('Error inspecting discovered database endpoints', error);
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  handleRequestError(message, error) {
    const errorEntry = `[${new Date().toISOString()}] ${message}: ${error.message}\n`;

    // Append error entry to the error log file
    fs.appendFile(this.errorLogFile, errorEntry, err => {
      if (err) {
        console.error(`Error writing to error log file: ${err.message}`);
      }
    });

    console.error(`${message}: ${error.message}`);
  }
}

const url = process.argv[2];

if (!url) {
  console.error('Please provide a URL as a command-line argument.');
  process.exit(1);
}

const webBot = new WebBot(url);

// Crawl and parse the website
webBot.crawlAndParse();

// Once your crawling and parsing is complete, you can choose to trigger Wireshark capture
// This can be done using an HTTP request to the server or through another mechanism.
// For simplicity, I'm assuming that the Wireshark capture is triggered in the server.js example.

// Note: Setting up Wireshark capture might require additional permissions and configuration.
