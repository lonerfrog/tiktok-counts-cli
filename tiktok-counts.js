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
		return { retries: 3 } // Default retries
	}
}

// Read TikTok usernames from a file
function readUsernamesFromFile(filePath) {
	try {
		const data = fs.readFileSync(filePath, 'utf-8')
		return data
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
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

// Scrape TikTok profile data
async function scrapeTikTokProfile(username, retries) {
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
			const exists = await checkUserExists(page, username)
			if (!exists) {
				console.log(`User @${username} does not exist.`)
				await browser.close()
				return { username, error: 'User not found' }
			}

			await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
			await page.waitForSelector('[data-e2e="followers-count"]', {
				timeout: 20000,
			})

			const data = await page.evaluate(() => {
				const followers = parseInt(
					document
						.querySelector('[data-e2e="followers-count"]')
						?.textContent.replace(/,/g, '') || '0'
				)
				const likes = parseInt(
					document
						.querySelector('[data-e2e="likes-count"]')
						?.textContent.replace(/,/g, '') || '0'
				)

				const videos = []
				let totalViews = 0
				document
					.querySelectorAll('div[data-e2e="user-post-item"]')
					.forEach((video) => {
						const views = parseInt(
							video
								.querySelector('strong[data-e2e="video-views"]')
								?.textContent.replace(/,/g, '') || '0'
						)
						const link = video.querySelector('a')?.href || 'N/A'
						videos.push({ views, link })
						totalViews += views
					})

				return { followers, likes, totalViews, videos }
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

// Ensure reports folder exists
function ensureReportsFolder() {
	const reportsPath = path.join(__dirname, 'reports')
	if (!fs.existsSync(reportsPath)) {
		fs.mkdirSync(reportsPath)
	}
	return reportsPath
}

// Main function
;(async () => {
	const inputFilePath = 'tiktok_users.txt'
	const configFilePath = 'config.json'

	const { retries } = loadConfig(configFilePath)
	const usernames = readUsernamesFromFile(inputFilePath)

	if (usernames.length === 0) {
		console.error('No usernames found. Exiting...')
		process.exit(1)
	}

	console.log(`Starting TikTok scraping for ${usernames.length} users...`)

	const progressBar = new cliProgress.SingleBar(
		{},
		cliProgress.Presets.shades_classic
	)
	progressBar.start(usernames.length, 0)

	const results = []
	let totalVideos = 0
	let grandTotalFollowers = 0
	let grandTotalLikes = 0
	let grandTotalViews = 0

	let userWithMostFollowers = { username: null, followers: 0 }
	let videoWithMostViews = { link: null, views: 0 }

	for (const username of usernames) {
		const data = await scrapeTikTokProfile(username, retries)
		results.push(data)

		if (!data.error) {
			totalVideos += data.videos.length
			grandTotalFollowers += data.followers || 0
			grandTotalLikes += data.likes || 0
			grandTotalViews += data.totalViews || 0

			if (data.followers > userWithMostFollowers.followers) {
				userWithMostFollowers = {
					username: data.username,
					followers: data.followers,
				}
			}

			const highestViewedVideo = data.videos.reduce(
				(max, video) => (video.views > max.views ? video : max),
				{ views: 0 }
			)
			if (highestViewedVideo.views > videoWithMostViews.views) {
				videoWithMostViews = highestViewedVideo
			}
		}

		progressBar.increment()
	}

	progressBar.stop()

	const reportsFolder = ensureReportsFolder()
	const now = new Date()
	const timestamp = now.toISOString().replace(/[:.]/g, '-')
	const outputFilePath = path.join(
		reportsFolder,
		`tiktok_results_${timestamp}.json`
	)

	const outputData = {
		results,
		totals: {
			totalFollowers: grandTotalFollowers,
			totalLikes: grandTotalLikes,
			totalViews: grandTotalViews,
			totalVideos: totalVideos,
			totalUsers: usernames.length,
		},
		highest: {
			userWithMostFollowers,
			videoWithMostViews,
		},
	}

	fs.writeFileSync(outputFilePath, JSON.stringify(outputData, null, 2))
	console.log(`Results saved to ${outputFilePath}`)

	// Print summary
	console.log('\n--- Summary ---')
	console.log(`Total Users: ${usernames.length}`)
	console.log(`Total Videos: ${totalVideos}`)
	console.log(
		`User with most followers: @${userWithMostFollowers.username} (${userWithMostFollowers.followers} followers)`
	)
	console.log(
		`Video with most views: ${videoWithMostViews.link} (${videoWithMostViews.views} views)`
	)
	console.log(`Total Followers: ${grandTotalFollowers}`)
	console.log(`Total Likes: ${grandTotalLikes}`)
	console.log(`Total Views: ${grandTotalViews}`)
})()
