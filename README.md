# Common Ground live quiz

A zero-dependency, Kahoot-style classroom quiz about loneliness, teenagers, older adults, and intergenerational companionship.

## Run it

1. Double-click `start-quiz.command` on the presenter computer. The quiz opens automatically in the browser. Keep the terminal window open.
2. Select **Host this quiz** and project that browser window.
3. Classmates open the `Classroom Wi-Fi` address shown on the host screen, enter the six-digit code, and choose a display name.

Do not open `public/index.html` directly. The live room needs the local server started by `start-quiz.command`.

The host controls when each answer is revealed and when the next question starts. Scores reward correct and faster answers. Opinion polls do not award points.

## Important classroom setup

The presenter computer and student phones must be on the same Wi-Fi network. Some school networks block devices from talking to each other. If that happens, connect the presenter computer and phones to the same personal hotspot.

The server stores rooms and scores only in memory. Restarting the server clears the current game.

## Permanent public link

The included `render.yaml` deploys the quiz as a Render web service. Connect this folder through a Git repository to Render and deploy the Blueprint. Render assigns a public `onrender.com` address with managed HTTPS.

The free Render plan may sleep after 15 minutes without visitors and takes up to about one minute to wake on the next visit. A paid instance stays ready continuously. Active rooms and scores are held in memory, so they reset if the service restarts or sleeps.
