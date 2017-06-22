const { json, send } = require('micro')
const GitHubApi = require('github')

const config = require('./config')

const github = new GitHubApi({
  debug: config.debug,
  headers: {
    'user-agent': 'gold-miner-robot',
  },
})

github.authenticate({
  type: 'token',
  token: config.github.token,
})

const addComment = function addComment(number, body) {
  return github.issues.createComment({
    owner: config.github.owner,
    repo: config.github.repo,
    number,
    body,
  })
}

const removeLabel = function removeLabel(number, label) {
  return github.issues.removeLabel({
    owner: config.github.owner,
    repo: config.github.repo,
    number,
    name: label,
  })
}

const addLabels = function addLabels(number, labels) {
  return github.issues.addLabels({
    owner: config.github.owner,
    repo: config.github.repo,
    number,
    labels,
  })
}

const handleApplyForTranslation = async function (payload) {
  const { issue, comment, sender } = payload
  let awaitTranslation = false

  for (let i = 0; i < issue.labels.length; i += 1) {
    if (issue.labels[i].name === '翻译认领') {
      awaitTranslation = true
      break
    }
  }

  if (!awaitTranslation) return

  if (comment.body.includes('认领')) {
    try {
      await Promise.all([
        addComment(issue.number, `@${comment.user.login} 棒极啦 :tada:`),
        removeLabel(issue.number, '翻译认领'),
        addLabels(issue.number, ['正在翻译'])
      ])
    } catch(err) {
      return console.error(err)
    }

    console.log(`Handle request of ${sender.login} from #${issue.number} with message ${comment.body} successfully.`)
  } else {
    console.log(`Can not handle request of ${sender.login} from #${issue.number} with message ${comment.body}.`)
  }

  console.log('Done.')
}

const handleApplyForReview = async function (payload) {
  const { issue, comment, sender } = payload

  let awaitReview = false

  for (let i = 0; i < issue.labels.length; i += 1) {
    const label = issue.labels[i]

    if (label.name === '校对认领') {
      awaitReview = true
      break
    }
  }

  if (!awaitReview) return

  if (comment.body.includes('认领')) {
    let hasAtLeastOneReviewer = false

    for (let i = 0; i < issue.labels.length; i += 1) {
      const label = issue.labels[i]

      if (label.name === '正在校对') {
        hasAtLeastOneReviewer = true
        break
      }
    }

    try {
      console.log(`Trying to update PR #${issue.number} status.`)

      if (hasAtLeastOneReviewer) {
        await Promise.all([
          addComment(issue.number, `@${comment.user.login} 妥妥哒 :beers:`),
          removeLabel(issue.number, '校对认领')
        ])
      } else {
        await Promise.all([
          addComment(issue.number, `@${comment.user.login} 好的呢 :beer:`),
          addLabels(issue.number, ['正在校对'])
        ])
      }

      console.log(`Update PR #${issue.number} status successfully.`)
    } catch(err) {
      return console.error(err)
    }

    const matchedIssueNumber = /#\d+/.exec(issue.body)

    if (matchedIssueNumber) {
      const issueNumber = Number(matchedIssueNumber[0].substring(1))

      if (typeof issueNumber === 'number') {
        try {
          console.log(`Trying to update reference issue #${issue.number} status.`)

          if (hasAtLeastOneReviewer) {
            await removeLabel(issueNumber, '请到对应的 PR 下认领校对')
          } else {
            await addLabels(issueNumber, ['正在校对'])
          }

          console.log(`Update reference issue #${issue.number} status successfully.`)
        } catch (err) {
          console.error(err)
        }
      }
    }
    console.log(`Handle request of ${sender.login} from #${issue.number} with message ${comment.body} successfully .`)
  } else {
    console.log(`Can not handle request of ${sender.login} from #${issue.number} with message ${comment.body}.`)
  }

  console.log('Done.')
}

const handleNewPull = async function (payload) {
  const { pull_request: pull, sender } = payload

  console.log(`Trying to add label "校对认领" to pull ${pull.number}.`)

  await Promise.all([
    addLabels(pull.number, ['校对认领'])
  ])

  console.log(`Add label "校对认领" to pull ${pull.number} successfully.`)

  const matchedIssueNumber = /#\d+/.exec(pull.body)

  if (matchedIssueNumber) {
    const issueNumber = Number(matchedIssueNumber[0].substring(1))

    if (typeof issueNumber === 'number') {
      console.log(`Got the reference #${issueNumber} from pull #${pull.number}.`)

      try {
        console.log(`Trying to update issue #${issueNumber} status.`)

        await Promise.all([
          addComment(issueNumber, `PR 地址：#${pull.number}`),
          removeLabel(issueNumber, '正在翻译'),
          addLabels(issueNumber, ['请到对应的 PR 下认领校对'])
        ])

        console.log(`Update issue #${issueNumber} status successfully.`)
      } catch(err) {
        console.error(err)
      }
    }
  }

  console.log('Done.')
}

const handleNewIssue = async (payload) => {
  const { issue, sender } = payload

  if (issue.title.includes('推荐优秀英文文章')) {
    await addComment(issue.number, `:heart: 感谢有你 ♪(*´▽｀*)ノ`)
    console.log(`Reply issue #${issue.number} with title ${issue.title} successfully.`)
  }
}

module.exports = async (req, res) => {
  const eventName = req.headers['x-github-event']
  const payload = await json(req)

  if (payload.sender.login === 'sqrthree') return

  console.log(`Received GitHub event ${eventName} ${payload.action} from ${payload.sender.login}`)

  if (eventName === 'issue_comment' && payload.action === 'created') {
    if (payload.issue.html_url.includes('pull')) {
      handleApplyForReview(payload)
    } else {
      handleApplyForTranslation(payload)
    }
  }

  if (eventName === 'pull_request' && payload.action === 'opened') {
    handleNewPull(payload)
  }

  if (eventName === 'issues' && payload.action === 'opened') {
    handleNewIssue(payload)
  }

  console.log(`No response.`)

  send(res, 200)
}
