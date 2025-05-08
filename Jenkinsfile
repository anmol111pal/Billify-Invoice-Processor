pipeline {
    agent any
    
    stages {
        stage("Code") {
            steps {
                git "https://github.com/anmol111pal/Billify-Invoice-Processor.git"
            }
        }
        
        stage("Install dependencies") {
            steps {
                sh "npm install"
            }
        }
        
        stage("Build") {
            steps {
                sh "npm run build"
            }
        }
        
        stage("Test") {
            steps {
                sh "npm run test"
            }
        }
        
        stage("Deploy") {
            steps {
                withCredentials([[
                        $class: "AmazonWebServicesCredentialsBinding",
                        credentialsId: "aws-creds-jenkins",
                        accessKeyId: "AWS_ACCESS_KEY_ID",
                        secretAccessKey: "AWS_SECRET_ACCESS_KEY"]]) {
                            sh "cdk deploy --require-approval never"
                }
            }
        }
    }
}
