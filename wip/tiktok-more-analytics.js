const fs = require('fs')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const path = require('path')
const cliProgress = require('cli-progress')

// Enable stealth mode to bypass detection
puppeteer.use(StealthPlugin())

// Load configuration
function loadConfig(configPath) {
	try {
		const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
		return config
	} catch (error) {
		console.error(`Error loading config file: ${error.message}`)
		return { retries: 3 }
	}
}

// Read TikTok usernames from a file
function readUsernamesFromFile(filePath) {
	try {
		const data = fs.readFileSync(filePath, 'utf-8')
		// Split lines, trim spaces, filter blanks, and remove duplicates using a Set
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

// Check if TikTok user exists
async function checkUserExists(page, username) {
	try {
		const url = `https://www.tiktok.com/@${username}`
		await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
		const notFound = await page.$("div[data-e2e='user-not-found']")
		return !notFound
	} catch (error) {
		return false
	}
}

// Helper to get top N users based on a metric
function getTopUsers(results, metric, rankLimit) {
	return results
		.filter((user) => !user.error)
		.sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
		.slice(0, rankLimit)
		.map((user) => ({ username: user.username, [metric]: user[metric] }))
}

// Convert TikTok shorthand like "13K", "12.3K", or "1.5M" to an integer
function parseShorthandNumber(value) {
	if (!value) return 0

	const multiplier = value.includes('K')
		? 1000
		: value.includes('M')
		? 1000000
		: 1

	return parseFloat(value.replace(/[KM]/, '').replace(/,/g, '')) * multiplier
}

function loadPreviousResults(reportsFolder) {
	const files = fs
		.readdirSync(reportsFolder)
		.filter(
			(file) => file.startsWith('tiktok_results_') && file.endsWith('.json')
		)
		.sort() // Sort alphabetically, which works as they are timestamped

	if (files.length === 0) return null

	const lastFile = files[files.length - 1]
	const lastFilePath = path.join(reportsFolder, lastFile)
	console.log(`Comparing data with previous results: ${lastFile}`)
	return JSON.parse(fs.readFileSync(lastFilePath, 'utf-8'))
}

function calculateDifferences(currentResults, previousResults) {
	const differences = {}

	;(currentResults || []).forEach((currentUser) => {
		const previousUser = (previousResults.results || []).find(
			(user) => user.username === currentUser.username
		)

		if (previousUser) {
			differences[currentUser.username] = {
				followersChange: currentUser.followers - (previousUser.followers || 0),
				likesChange: currentUser.likes - (previousUser.likes || 0),
				totalViewsChange: currentUser.totalViews - (previousUser.totalViews || 0),
			}
		} else {
			// If no previous data, consider all values as new
			differences[currentUser.username] = {
				followersChange: currentUser.followers,
				likesChange: currentUser.likes,
				totalViewsChange: currentUser.totalViews,
			}
		}
	})

	return differences
}

// Scrape TikTok profile data
async function scrapeTikTokProfile(username, retries, progressBar) {
	const url = `https://www.tiktok.com/@${username}`
	const browser = await puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	})

	const page = await browser.newPage()
	await page.setUserAgent(
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
	)

	for (let i = 0; i < retries; i++) {
		try {
			progressBar.update({ username: `@${username}` })

			// Check if the user exists
			const exists = await checkUserExists(page, username)
			if (!exists) {
				console.log(`User @${username} does not exist.`)
				await browser.close()
				return { username, error: 'User not found' }
			}

			// Navigate to the user's profile
			await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
			await page.waitForSelector('[data-e2e="followers-count"]', {
				timeout: 20000,
			})

			// Extract data
			const data = await page.evaluate((parseShorthandNumber) => {
				// Helper to parse shorthand numbers
				function parseShorthand(value) {
					if (!value) return 0
					const multiplier = value.includes('K')
						? 1000
						: value.includes('M')
						? 1000000
						: 1
					return parseFloat(value.replace(/[KM]/, '').replace(/,/g, '')) * multiplier
				}

				// Followers and likes
				const followersText =
					document.querySelector('[data-e2e="followers-count"]')?.textContent || '0'
				const likesText =
					document.querySelector('[data-e2e="likes-count"]')?.textContent || '0'

				const followers = parseShorthand(followersText)
				const likes = parseShorthand(likesText)

				// Extract videos and views
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
			}, parseShorthandNumber.toString())

			await browser.close()
			return { username, ...data }
		} catch (error) {
			console.log(`Retrying @${username}, attempt ${i + 1}`)
		}
	}

	await browser.close()
	return { username, error: 'Failed after retries' }
}

// Ensure reports folder exists
function ensureReportsFolder() {
	const reportsPath = path.join(__dirname, 'reports')
	if (!fs.existsSync(reportsPath)) fs.mkdirSync(reportsPath)
	return reportsPath
}

// Helper to get top N users based on a metric
function getTopUsers(results, metric, count = 5) {
	return results
		.filter((user) => !user.error)
		.sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
		.slice(0, count)
		.map((user) => ({ username: user.username, [metric]: user[metric] }))
}

;(async () => {
	const inputFilePath = 'tiktok_users.txt'
	const configFilePath = 'config.json'

	const { retries, rankLimit } = loadConfig(configFilePath)
	const usernames = readUsernamesFromFile(inputFilePath)
	const reportsFolder = ensureReportsFolder()

	if (usernames.length === 0) {
		console.error('No usernames found. Exiting...')
		process.exit(1)
	}

	// Load previous results if available
	const previousResults = loadPreviousResults(reportsFolder)

	console.log(`Starting TikTok scraping for ${usernames.length} users...`)
	const progressBar = new cliProgress.SingleBar(
		{
			format:
				'Progress [{bar}] {percentage}% | {value}/{total} Users | Current User: {username}',
		},
		cliProgress.Presets.shades_classic
	)
	progressBar.start(usernames.length, 0, { username: '' })

	const results = []
	for (const username of usernames) {
		const data = await scrapeTikTokProfile(username, retries, progressBar)
		results.push(data)
		progressBar.increment()
	}

	progressBar.stop()

	// Totals
	const totalVideos = results.reduce(
		(sum, user) => sum + (user.totalVideos || 0),
		0
	)
	const totalFollowers = results.reduce(
		(sum, user) => sum + (user.followers || 0),
		0
	)
	const totalLikes = results.reduce((sum, user) => sum + (user.likes || 0), 0)
	const totalViews = results.reduce(
		(sum, user) => sum + (user.totalViews || 0),
		0
	)

	// Top Rankings
	const topUsersByFollowers = getTopUsers(results, 'followers', rankLimit)
	const topUsersByViews = getTopUsers(results, 'totalViews', rankLimit)
	const topUsersByLikes = getTopUsers(results, 'likes', rankLimit)

	const videoWithMostViews = results
		.flatMap((user) => user.videos || [])
		.reduce((max, video) => (video.views > max.views ? video : max), { views: 0 })

	// Compare with previous results
	const differences = previousResults
		? calculateDifferences(results, previousResults)
		: {}

	// Save Results
	const now = new Date()
	const timestamp = now.toISOString().replace(/[:.]/g, '-')
	const outputFilePath = path.join(
		reportsFolder,
		`tiktok_results_${timestamp}.json`
	)

	const outputData = {
		timestamp: now.toISOString(),
		results,
		differences,
		totals: {
			totalUsers: usernames.length,
			totalVideos,
			totalFollowers,
			totalLikes,
			totalViews,
		},
		highest: {
			topUsersByFollowers,
			topUsersByViews,
			topUsersByLikes,
			videoWithMostViews,
		},
	}

	fs.writeFileSync(outputFilePath, JSON.stringify(outputData, null, 2))
	console.log(`Results saved to ${outputFilePath}`)

	// Print Summary
	console.log('\n--- Loner TikTok Stats ---')
	console.log(`Total Users: ${usernames.length}`)
	console.log(`Total Videos: ${totalVideos}`)
	console.log(`Total Followers: ${totalFollowers}`)
	console.log(`Total Likes: ${totalLikes}`)
	console.log(`Total Views: ${totalViews}`)

	// Print Changes
	if (previousResults) {
		console.log('\n--- Changes Since Last Run ---')
		Object.entries(differences).forEach(([username, diff]) => {
			console.log(
				`@${username}: Followers: ${diff.followersChange >= 0 ? '+' : ''}${
					diff.followersChange
				}, Likes: ${diff.likesChange >= 0 ? '+' : ''}${diff.likesChange}, Views: ${
					diff.totalViewsChange >= 0 ? '+' : ''
				}${diff.totalViewsChange}`
			)
		})

		const timeSinceLastRun = Math.round(
			(now - new Date(previousResults.timestamp)) / 1000 / 60
		)
		console.log(`\nTime since last run: ${timeSinceLastRun} minutes.`)
	}

	console.log(`\nTop ${rankLimit} Users by Followers:`)
	topUsersByFollowers.forEach((user, i) =>
		console.log(`${i + 1}. @${user.username} - ${user.followers} followers`)
	)
})()