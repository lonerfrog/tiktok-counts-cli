const fs = require('fs')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const path = require('path')
const cliProgress = require('cli-progress')

// Enable stealth mode to bypass detection
puppeteer.use(StealthPlugin())

// Calculate time difference in human-readable format
function calculateTimeDifference(current, previous) {
	// Ensure both arguments are valid Date objects
	if (!(current instanceof Date) || !(previous instanceof Date)) {
		return 'Invalid timestamp'
	}

	const msDifference = current - previous
	const seconds = Math.floor((msDifference / 1000) % 60)
	const minutes = Math.floor((msDifference / (1000 * 60)) % 60)
	const hours = Math.floor((msDifference / (1000 * 60 * 60)) % 24)
	const days = Math.floor(msDifference / (1000 * 60 * 60 * 24))
	return `${days}d ${hours}h ${minutes}m ${seconds}s ago`
}

// Scrape TikTok profile data
async function scrapeTikTokProfile(username, retries, logFilePath) {
	const url = `https://www.tiktok.com/@${username}`
	const browser = await puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	})

	const page = await browser.newPage()
	await page.setUserAgent(
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
	)

	let attempts = 0
	let data = null

	while (attempts < retries) {
		attempts++
		try {
			await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
			const userExists = await page.evaluate(() => {
				return !document.querySelector('div[data-e2e="error-page"]')
			})

			if (!userExists) {
				throw new Error(`User @${username} does not exist or is unavailable.`)
			}

			await page.waitForSelector('[data-e2e="followers-count"]', {
				timeout: 20000,
			})

			// Extract data
			data = await page.evaluate(() => {
				function parseShorthand(value) {
					if (!value) return 0
					const multiplier = value.includes('K')
						? 1000
						: value.includes('M')
						? 1000000
						: 1
					return parseFloat(value.replace(/[KM]/, '').replace(/,/g, '')) * multiplier
				}

				const followersText =
					document.querySelector('[data-e2e="followers-count"]')?.textContent || '0'
				const likesText =
					document.querySelector('[data-e2e="likes-count"]')?.textContent || '0'

				const followers = parseShorthand(followersText)
				const likes = parseShorthand(likesText)

				const videos = []
				let totalViews = 0

				document
					.querySelectorAll('div[data-e2e="user-post-item"]')
					.forEach((video) => {
						const viewsText =
							video.querySelector('strong[data-e2e="video-views"]')?.textContent || '0'
						const views = parseShorthand(viewsText)
						const link = video.querySelector('a')?.href || 'N/A'

						videos.push({ views, link })
						totalViews += views
					})

				return { followers, likes, totalViews, totalVideos: videos.length, videos }
			})

			if (data.videos.length > 0) break // Exit loop if videos are found
		} catch (error) {
			if (error.message.includes('Timeout')) {
				console.error(`Timeout exceeded for @${username}. Moving to next user.`)
				break
			}
			fs.appendFileSync(
				logFilePath,
				`Retrying @${username}, attempt ${attempts} - Error: ${error.message}
`
			)
		}
	}

	await browser.close()

	if (!data || data.videos.length === 0) {
		return { username, error: 'Failed to fetch non-empty videos after retries' }
	}

	return { username, ...data }
}

// Process users in batches to control concurrency
async function processInBatches(usernames, batchSize, task, logFilePath) {
	const results = []
	const progressBar = new cliProgress.SingleBar(
		{
			format:
				'Progress [{bar}] {percentage}% | {value}/{total} Users | Current User: {username}',
			clearOnComplete: true, // Clears the progress bar after completion
		},
		cliProgress.Presets.shades_classic
	)
	progressBar.start(usernames.length, 0, { username: '' })

	for (let i = 0; i < usernames.length; i += batchSize) {
		const batch = usernames.slice(i, i + batchSize).map((username) =>
			task(username, logFilePath).then((result) => {
				progressBar.increment(1, { username: `@${username}` })
				return result
			})
		)
		results.push(...(await Promise.all(batch)))
	}

	progressBar.stop()
	return results
}

// Load configuration
function loadConfig(configPath) {
	try {
		const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
		return { ...config, batchSize: config.batchSize || 5 }
	} catch (error) {
		console.error(`Error loading config file: ${error.message}`)
		return { retries: 3, rankLimit: 5, batchSize: 5 }
	}
}

// Read TikTok usernames from a file
function readUsernamesFromFile(filePath) {
	try {
		const data = fs.readFileSync(filePath, 'utf-8')
		const usernames = Array.from(
			new Set(
				data
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean)
			)
		)
		console.log(`Loaded ${usernames.length} unique usernames.`)
		return usernames
	} catch (error) {
		console.error(`Error reading usernames file: ${error.message}`)
		return []
	}
}

// Format large numbers into shorthand (e.g., 4.3M, 323K)
function formatNumber(value) {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
	return value.toString()
}

// Calculate differences for metrics
function calculateDifferences(current, previous) {
	return {
		totalUsers: current.totalUsers - (previous.totalUsers || 0),
		totalVideos: current.totalVideos - (previous.totalVideos || 0),
		totalFollowers: current.totalFollowers - (previous.totalFollowers || 0),
		totalLikes: current.totalLikes - (previous.totalLikes || 0),
		totalViews: current.totalViews - (previous.totalViews || 0),
	}
}

// Get the top N users based on a specific metric
function getTopUsers(results, metric, count = 5) {
	return results
		.filter((user) => !user.error)
		.sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
		.slice(0, count)
		.map(
			(user, index) =>
				`${index + 1}. ${user.username} - ${formatNumber(user[metric] || 0)}`
		)
		.join('\n')
}

// Load the most recent report
function loadLastReport(reportsFolder) {
	const reportFiles = fs
		.readdirSync(reportsFolder)
		.filter(
			(file) => file.startsWith('tiktok_results_') && file.endsWith('.json')
		)
		.sort()

	if (reportFiles.length === 0) return null

	for (let i = reportFiles.length - 1; i >= 0; i--) {
		const filePath = path.join(reportsFolder, reportFiles[i])
		const report = JSON.parse(fs.readFileSync(filePath, 'utf-8'))

		if (report.timestamp) {
			const timestamp = new Date(report.timestamp)
			if (!isNaN(timestamp)) {
				report.timestamp = timestamp
				return report
			}
		}
	}

	console.warn('No valid timestamp found in any report file.')
	return null
}

async function validateVideoCounts(results, lastReport, logFilePath) {
	const videoBufferCount = 5

	if (!lastReport) return results

	const previousResults = lastReport.results.reduce((map, user) => {
		map[user.username] = user.totalVideos
		return map
	}, {})

	for (const user of results) {
		if (!user.error && previousResults[user.username] !== undefined) {
			const previousVideos = previousResults[user.username]
			if (user.totalVideos + videoBufferCount < previousVideos) {
				console.warn(
					`Warning: @${user.username} has fewer videos (${user.totalVideos}) than previously reported (${previousVideos}). Retrying...`
				)

				const retryResult = await scrapeTikTokProfile(user.username, 1, logFilePath)
				if (!retryResult.error && retryResult.totalVideos >= previousVideos) {
					Object.assign(user, retryResult)
					console.log(
						`@${user.username} updated with new video count: ${user.totalVideos}`
					)
				} else {
					console.warn(`@${user.username} video count could not be corrected.`)
				}
			}
		}
	}

	return results
}

// Main function
;(async () => {
	const inputFilePath = 'users/tiktok_users.txt'
	const configFilePath = 'config.json'
	const reportsFolder = path.join(__dirname, 'reports')
	const logFilePath = path.join(reportsFolder, 'retry_log.txt')

	if (!fs.existsSync(reportsFolder)) fs.mkdirSync(reportsFolder)

	const { retries, rankLimit, batchSize } = loadConfig(configFilePath)
	const usernames = readUsernamesFromFile(inputFilePath)

	if (usernames.length === 0) {
		console.error('No usernames found. Exiting...')
		process.exit(1)
	}

	console.log(`Starting TikTok scraping for ${usernames.length} users...`)

	// Load the last report and calculate time difference
	const lastReport = loadLastReport(reportsFolder)
	const now = new Date()

	let timeDifference = null
	if (lastReport && lastReport.timestamp) {
		console.log(`Last report generated: ${lastReport.timestamp}`)
		timeDifference = calculateTimeDifference(now, lastReport.timestamp)
	}

	// Clear the log file at the start of execution
	fs.writeFileSync(logFilePath, '')

	const results = await processInBatches(
		usernames,
		batchSize,
		(username, logPath) => scrapeTikTokProfile(username, retries, logPath)
	)

	const validatedResults = await validateVideoCounts(
		results,
		lastReport,
		logFilePath
	)

	const totals = {
		totalUsers: usernames.length,
		totalVideos: validatedResults.reduce(
			(sum, user) => sum + (user.totalVideos || 0),
			0
		),
		totalFollowers: validatedResults.reduce(
			(sum, user) => sum + (user.followers || 0),
			0
		),
		totalLikes: validatedResults.reduce(
			(sum, user) => sum + (user.likes || 0),
			0
		),
		totalViews: validatedResults.reduce(
			(sum, user) => sum + (user.totalViews || 0),
			0
		),
	}

	let differences = null
	if (lastReport) {
		differences = calculateDifferences(totals, lastReport.totals)
	}

	const topUsersByFollowers = getTopUsers(results, 'followers', rankLimit)
	const topUsersByViews = getTopUsers(results, 'totalViews', rankLimit)
	const topUsersByLikes = getTopUsers(results, 'likes', rankLimit)

	const timestamp = now.toISOString().replace(/[:.]/g, '-')
	const outputFilePath = path.join(
		reportsFolder,
		`tiktok_results_${timestamp}.json`
	)

	// Include the timestamp in the output data
	const outputData = {
		timestamp: now.toISOString(), // Save the timestamp
		results: validatedResults,
		totals,
		highest: {
			topUsersByFollowers,
			topUsersByViews,
			topUsersByLikes,
		},
	}

	fs.writeFileSync(outputFilePath, JSON.stringify(outputData, null, 2))
	console.log(`\nResults saved to ${outputFilePath}`)

	// Print summary
	console.log('\n--- TikTok Takeover Stats ---')

	console.log(
		`Total Users: ${totals.totalUsers} (${
			differences?.totalUsers >= 0 ? '+' : ''
		}${differences?.totalUsers || 0})`
	)
	console.log(
		`Total Videos: ${totals.totalVideos} (${
			differences?.totalVideos >= 0 ? '+' : ''
		}${differences?.totalVideos || 0})`
	)
	console.log(
		`Total Followers: ${formatNumber(totals.totalFollowers)} (${
			differences?.totalFollowers >= 0 ? '+' : ''
		}${formatNumber(differences?.totalFollowers || 0)})`
	)
	console.log(
		`Total Likes: ${formatNumber(totals.totalLikes)} (${
			differences?.totalLikes >= 0 ? '+' : ''
		}${formatNumber(differences?.totalLikes || 0)})`
	)
	console.log(
		`Total Views: ${formatNumber(totals.totalViews)} (${
			differences?.totalViews >= 0 ? '+' : ''
		}${formatNumber(differences?.totalViews || 0)})`
	)
	console.log(`\nTop ${rankLimit} Users by Followers:\n${topUsersByFollowers}`)
	console.log(`\nTop ${rankLimit} Users by Views:\n${topUsersByViews}`)
	console.log(`\nTop ${rankLimit} Users by Likes:\n${topUsersByLikes}`)

	if (timeDifference) {
		console.log(`\nLast report generated: ${timeDifference}`)
	} else {
		console.log('\nThis is the first report generated.')
	}
})()
