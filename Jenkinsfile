pipeline {
  agent { label 'swarm-manager' }

  options {
    disableConcurrentBuilds()
  }

  triggers {
    pollSCM('H/2 * * * *')
  }

  stages {
    stage('Test, build, push and deploy') {
      steps {
        sh '''
          set -eu
          : "${NFS_SERVER:?Set NFS_SERVER in Jenkins}"
          : "${NFS_EXPORT:?Set NFS_EXPORT in Jenkins}"

          IMAGE="nas-server.local:5000/jupas-app:sha-$(git rev-parse --short=12 HEAD)"

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
