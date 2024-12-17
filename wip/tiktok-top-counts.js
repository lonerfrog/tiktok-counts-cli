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
		return { retries: 3, rankLimit: 3 }
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

// Load previous results for comparison
function loadPreviousResults(reportsFolder) {
	const files = fs
		.readdirSync(reportsFolder)
		.filter(
			(file) => file.startsWith('tiktok_results_') && file.endsWith('.json')
		)
		.sort()
	if (files.length === 0) return null

	const lastFile = files[files.length - 1]
	const lastFilePath = path.join(reportsFolder, lastFile)
	console.log(`Comparing data with previous results: ${lastFile}`)
	return JSON.parse(fs.readFileSync(lastFilePath, 'utf-8'))
}

// Calculate differences between current and previous totals or rankings
function calculateDifferences(current, previous) {
	const differences = {}
	for (const key in current) {
		differences[key] = current[key] - (previous[key] || 0)
	}
	return differences
}

// Compare top users with previous top users
function compareTopUsers(currentTop, previousTop) {
	// Ensure previousTop is an array, otherwise default to an empty array
	previousTop = Array.isArray(previousTop) ? previousTop : []

	return currentTop.map((user) => {
		// Find matching user in previousTop or default to an empty value
		const prevUser = previousTop.find((u) => u.username === user.username) || {
			value: 0,
		}
		const diff = user.value - (prevUser.value || 0)

		return { alias: `@${user.username}`, value: user.value, diff }
	})
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
			await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
			await page.waitForSelector('[data-e2e="followers-count"]', {
				timeout: 20000,
			})

			const data = await page.evaluate(() => {
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

				return {
					followers: parseShorthand(followersText),
					likes: parseShorthand(likesText),
					totalViews,
					totalVideos: videos.length,
					videos,
				}
			})

			await browser.close()
			return { username, ...data }
		} catch (error) {
			console.log(`Retrying @${username}, attempt ${i + 1}`)
		}
	}

	await browser.close()
	return { username, error: 'Failed after retries' }
}

// Helper to get top N users based on a metric
function getTopUsers(results, metric, count = 3) {
	return results
		.filter((user) => !user.error)
		.sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
		.slice(0, count)
		.map((user) => ({ username: user.username, value: user[metric], metric }))
}

;(async () => {
	const inputFilePath = 'tiktok_users.txt'
	const configFilePath = 'config.json'
	const reportsFolder = path.join(__dirname, 'reports')

	if (!fs.existsSync(reportsFolder)) fs.mkdirSync(reportsFolder)

	const { retries, rankLimit } = loadConfig(configFilePath)
	const usernames = readUsernamesFromFile(inputFilePath)
	const previousResults = loadPreviousResults(reportsFolder)

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

	const totals = {
		totalUsers: results.length,
		totalVideos: results.reduce((sum, user) => sum + (user.totalVideos || 0), 0),
		totalFollowers: results.reduce((sum, user) => sum + (user.followers || 0), 0),
		totalLikes: results.reduce((sum, user) => sum + (user.likes || 0), 0),
		totalViews: results.reduce((sum, user) => sum + (user.totalViews || 0), 0),
	}

	const topFollowers = getTopUsers(results, 'followers', rankLimit)
	const topViews = getTopUsers(results, 'totalViews', rankLimit)
	const topLikes = getTopUsers(results, 'likes', rankLimit)

	const differences = previousResults
		? calculateDifferences(totals, previousResults.totals)
		: null

	const now = new Date()
	const timestamp = now.toISOString().replace(/[:.]/g, '-')
	const outputFilePath = path.join(
		reportsFolder,
		`tiktok_results_${timestamp}.json`
	)

	fs.writeFileSync(
		outputFilePath,
		JSON.stringify(
			{
				timestamp: now.toISOString(),
				totals,
				results,
				topFollowers,
				topViews,
				topLikes,
			},
			null,
			2
		)
	)

	console.log('\n--- Summary ---')
	for (const [key, value] of Object.entries(totals)) {
		const diff = differences
			? ` (${differences[key] >= 0 ? '+' : ''}${differences[key]})`
			: ''
		console.log(`${key.replace(/([A-Z])/g, ' $1')}: ${value}${diff}`)
	}

	if (previousResults && previousResults.topFollowers) {
		console.log('\n--- Top Users Comparisons ---')

		console.log('\nTop 3 Users by Followers:')
		console.table(compareTopUsers(topFollowers, previousResults.topFollowers))

		console.log('\nTop 3 Users by Views:')
		console.table(compareTopUsers(topViews, previousResults.topViews))

		console.log('\nTop 3 Users by Likes:')
		console.table(compareTopUsers(topLikes, previousResults.topLikes))
	}
})()
