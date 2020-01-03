pipeline {
    agent { 
        kubernetes {
            label 'demo'
            defaultContainer 'jnlp'
            yaml """
              apiVersion: v1
              kind: Pod
              metadata:
              labels:
                component: ci
              spec:
                containers:
                - name: helm
                  image: alpine/helm:2.11.0
                  command:
                  - cat
                  tty: true
                - name: node
                  image: node
                  command:
                  - cat
                  tty: true
                - name: kaniko
                  image: gcr.io/kaniko-project/executor:debug
                  command:
                  - /busybox/cat
                  tty: true
                  volumeMounts:
                  - name: docker-secret-volume
                    mountPath: /kaniko/.docker/
                volumes:
                - name: docker-secret-volume
                  secret:
                    secretName: docker-secret
            """
        }
     }
    stages {
        stage('install dependency') {
          steps {
            container('node') {
              sh 'yarn install'
            }
          }
        }
        stage('test') {
          steps {
            container('node') {
              sh 'yarn run test'
            }
          }
        }
        stage('build') {
          steps {
            container('node') {
              sh 'yarn run build    '
            }
          }
        }
        stage('push image') {
          steps {
            container(name: 'kaniko', shell: '/busybox/sh') {
              sh "/kaniko/executor --dockerfile=`pwd`/Dockerfile --context=`pwd` --destination=twisger/ci-demo:0.0.2"
            }
          }
        }
        stage('deploy') {
          steps {
              container(name: 'helm') {
                script {
                  sh("helm upgrade frontend-demo chart --install")
                }
              }
          }
        }
    }
}