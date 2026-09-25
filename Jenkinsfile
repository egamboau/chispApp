pipeline {
  agent none

  environment {
    GITHUB_REPO = 'egamboau/chispApp'
  }

  options {
    disableConcurrentBuilds()
  }

  triggers {
    pollSCM('H/2 * * * *')
  }

  stages {
    stage('Build and Push') {
      agent { label 'node-24' }
      stages {
        stage('Build') {
          steps {
            script {
              env.COMMIT_SHA = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
              env.IMAGE = "nas-server.local:5000/jupas-app:sha-${env.COMMIT_SHA.take(12)}"
              sendGitHubStatus('pending', 'Building Docker image...', 'Jenkins / Build')
            }
            sh 'docker build --pull -t "$IMAGE" .'
          }
          post {
            success {
              script { sendGitHubStatus('success', 'Docker image built', 'Jenkins / Build') }
            }
            failure {
              script { sendGitHubStatus('failure', 'Docker build failed', 'Jenkins / Build') }
            }
          }
        }

        stage('Push') {
          steps {
            script { sendGitHubStatus('pending', 'Pushing Docker image...', 'Jenkins / Push') }
            sh 'docker push "$IMAGE"'
          }
          post {
            success {
              script { sendGitHubStatus('success', 'Docker image pushed', 'Jenkins / Push') }
            }
            failure {
              script { sendGitHubStatus('failure', 'Docker push failed', 'Jenkins / Push') }
            }
          }
        }
      }
    }

    stage('Deploy') {
      agent { label 'swarm-manager' }
      steps {
        script { sendGitHubStatus('pending', 'Deploying stack...', 'Jenkins / Deploy') }
        sh '''
          set -eu
          : "${NFS_SERVER:?Set NFS_SERVER in Jenkins}"
          : "${NFS_EXPORT:?Set NFS_EXPORT in Jenkins}"
          : "${CF_ACCESS_TEAM_DOMAIN:?Set CF_ACCESS_TEAM_DOMAIN in Jenkins}"
          : "${CF_ACCESS_AUD:?Set CF_ACCESS_AUD in Jenkins}"

          TOURNAMENT_IMAGE="$IMAGE" docker stack deploy \
            --with-registry-auth \
            --resolve-image always \
            -c stack.yml \
            tournament
        '''
      }
      post {
        success {
          script { sendGitHubStatus('success', 'Stack deployed', 'Jenkins / Deploy') }
        }
        failure {
          script { sendGitHubStatus('failure', 'Deployment failed', 'Jenkins / Deploy') }
        }
      }
    }
  }
}

def sendGitHubStatus(String state, String description, String context) {
  withCredentials([string(credentialsId: 'github-pat', variable: 'GITHUB_TOKEN')]) {
    sh """
      curl --fail --silent --show-error \
        --request POST \
        --header 'Accept: application/vnd.github+json' \
        --header "Authorization: Bearer \$GITHUB_TOKEN" \
        --header 'X-GitHub-Api-Version: 2022-11-28' \
        --data '{"state":"${state}","description":"${description}","context":"${context}","target_url":"${env.BUILD_URL}"}' \
        'https://api.github.com/repos/${env.GITHUB_REPO}/statuses/${env.COMMIT_SHA}'
    """
  }
}
