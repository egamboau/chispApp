pipeline {
  agent { label 'swarm-manager' }

  options {
    disableConcurrentBuilds()
  }

  triggers {
    pollSCM('H/2 * * * *')
  }

  stages {
    stage('Test') {
      steps {
        sh 'npm ci && npm test'
      }
    }

    stage('Build, push and deploy') {
      environment {
        GHCR = credentials('ghcr')
      }
      steps {
        sh '''
          set -eu
          : "${GHCR_IMAGE:?Set GHCR_IMAGE in Jenkins}"
          : "${NFS_SERVER:?Set NFS_SERVER in Jenkins}"
          : "${NFS_EXPORT:?Set NFS_EXPORT in Jenkins}"

          IMAGE="${GHCR_IMAGE}:sha-$(git rev-parse --short=12 HEAD)"
          echo "$GHCR_PSW" | docker login ghcr.io -u "$GHCR_USR" --password-stdin
          trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

          docker build --pull -t "$IMAGE" .
          docker push "$IMAGE"
          TOURNAMENT_IMAGE="$IMAGE" docker stack deploy \
            --with-registry-auth \
            --resolve-image always \
            -c stack.yml \
            tournament
        '''
      }
    }
  }
}
