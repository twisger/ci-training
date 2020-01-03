# 基于docker、jenkins、k8s等搭建持续集成环境

## 0.云主机相关

首先需要申请一台云主机，这里使用谷歌云。

创建实例-新建虚拟机实例：内存3.75GB，硬盘10GB，系统centOS 7， 防火墙允许http/https 流量。

只有一台主机的化，至少需要4GB内存，CPU最好是双核的，因为上面需要同时运行master节点和slave节点。

如果操作系统不是centOS 7 的话，docker和kubenetes等的安装建议参考官方文档。

新建的虚拟机的公网ip是动态的，最好手动修改为静态ip（需额外付费）。

左侧菜单选择vpc网络-外部ip地址，找到刚才新建的虚拟机，将类型从临时改成静态。

安装过程中大部分命令都需要root权限，建议使用`sudo -s`切换成root用户来执行。

## ssh相关配置
1. 方法一：修改项目的Metadata
    进入Metadata页面，SSH Keys 标签，edit，将自己的ssh公钥加进去。    
    然后命令行 `ssh -i [私钥路径] [用户名]@[服务器ip]`    

2. 方法二: 官方推荐使用的oslogin方法（推荐在生产环境使用，权限管理比较完善，但比较麻烦）
    1. 在Metadata菜单中修改metadata,添加一个key为`enable-oslogin`，值为`true`的字段，save。

    2. 在`Manage resources` 页面勾选对应的project,点击右上角show Info Panel,在permission panel中add member,并添加`serviceAccountUser`，`osAdminLogin`到自己的账号。

    3. 使用`gcloud`或`os login api`关联ssh 公钥到自己的账号。




# 1.安装Docker

## Docker简介

* Docker 属于 Linux 容器的一种封装，将应用程序与该程序的依赖，打包在一个文件里面。
* Docker 把应用程序及其依赖，打包在 image 文件里面。  
* image 是打包的文件，container是释放出的可以直接加载运行的文件。


## 安装docker(使用[Docker’s repositories](https://docs.docker.com/install/linux/docker-ce/centos/#install-using-the-repository) 方式)

1.前置依赖

```sh
sudo yum install -y yum-utils device-mapper-persistent-data lvm2
```

2.设置使用稳定版

```sh
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
```

3.安装

```sh
sudo yum install docker-ce docker-ce-cli containerd.io
```

4.启动docker服务

```sh
sudo systemctl start docker
```


# 2.安装kubernetes
## 简介
kubernete用于管理容器集群，包括自动化，部署，运行，更新等。helm用来管理k8s的资源，配置，应用模版。
简单来说就是用来管理多台服务器上的容器应用的工具，由master（管理集群本身）和node（跑容器应用）组成。

在Kubernetes中部署一个可以使用的应用，需要涉及到很多的 Kubernetes 资源的共同协作。这些 k8s 资源过于分散，不方便进行管理，helm可以用来管理这些资源的配置，解决配置问题。


一套高可用的 K8s 集群，至少需要 3 个 Master 节点，Worker 节点虽然没有明确要求，但至少 2 个 Worker 节点显然是比较恰当的。也就是说哪怕只是一个静态的 html 页面，K8s 也至少需要 4-5 台主机。

这里将Master节点和slave节点放在同一个主机上，生产环境不推荐这么做。

## 安装和配置(Kubernetes v1.7)
1. 前置([官方安装文档](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/))
* kuberadm 用来快速创建kubernetes集群，作用类似create-react-app
* kubelet 用于启动pods和容器的组件
* kubectl 集群的命令行工具

```
cat <<EOF > /etc/yum.repos.d/kubernetes.repo
[kubernetes]
name=Kubernetes
baseurl=https://packages.cloud.google.com/yum/repos/kubernetes-el7-x86_64
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=https://packages.cloud.google.com/yum/doc/yum-key.gpg https://packages.cloud.google.com/yum/doc/rpm-package-key.gpg
EOF

# Set SELinux in permissive mode (effectively disabling it)
setenforce 0
sed -i 's/^SELINUX=enforcing$/SELINUX=permissive/' /etc/selinux/config

yum install -y kubelet kubeadm kubectl --disableexcludes=kubernetes
# close swap [issue](https://github.com/kubernetes/kubernetes/issues/53533)
swapoff -a 
# close firewall (ensure ports [6443 10250] are open)
systemctl stop firewalld

systemctl enable --now kubelet
```

**修改docker默认使用的cgroupdriver**

``` 
cat > /etc/docker/daemon.json <<EOF
{
  "exec-opts": ["native.cgroupdriver=systemd"],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m"
  },
  "storage-driver": "overlay2",
  "storage-opts": [
    "overlay2.override_kernel_check=true"
  ]
}
EOF
```
`mkdir -p /etc/systemd/system/docker.service.d`  
`systemctl daemon-reload`
`systemctl restart docker`

2. 初始化控制面板节点(Master)

`kubeadm init --pod-network-cidr=10.244.0.0/16`
--pod-network-cidr  指定pod的ip地址范围， 设定后将自动分配每个节点的CIDRs。

接下来指定各个节点交流时使用的网络层工具，这里使用flannel。

```
  mkdir -p $HOME/.kube
  sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
  sudo chown $(id -u):$(id -g) $HOME/.kube/config
  # Alternatively, if you are the root user, you can run:
  export KUBECONFIG=/etc/kubernetes/admin.conf
  kubectl apply -f https://raw.githubusercontent.com/coreos/flannel/master/Documentation/kube-flannel.yml
```

3. 部署测试pod
  ```
  # 允许在 master 节点部署 pod（kubernetes默认禁止在同一个主机上部署master和slave）
  kubectl taint nodes --all node-role.kubernetes.io/master-

  kubectl run --rm --restart=Never -it --image=hello-world test-pod
  ```
  可以运行`kubectl get pods`查看刚才部署的test-pod，如果是running状态就说明安装成功了。

如果是pending或者其他的状态，说明存在问题。可以使用`kubectl describe pod [podid]`，`kubectl describe deployment id`等命令来排查问题。

然后可以使用`kubectl delete pod test-pod`删除测试pod。







# 3.在kubenetes集群上安装jenkins

直接在kubenetes上安装jenkins非常麻烦，需要写很多配置，所以这里使用helm来安装。

要在kubenetes上部署一个应用一般需要写很多配置文件，配置很多资源对象，比如应用的deployment，提供服务发现的service,提供存储持久化的pvc等，helm可以用来管理这些资源的配置，通过helm就可以简单的完成这些繁琐的配置。

## 安装helm([参考](https://www.jianshu.com/p/4bd853a8068b))
使用helm官方提供的shell脚本安装
```sh
$ curl https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3 > get_helm.sh
$ chmod 700 get_helm.sh
$ ./get_helm.sh
```
出现了一个报错`no helm in (/sbin:/bin:/usr/sbin:/usr/bin)`,实际上已经安装成功了，但是命令用不了，应该是环境变量没有添加成功。   

### 手动添加环境变量

```
vi ~/.bashrc
```

在这个文件里增加一行`export PATH=/usr/local/bin:$PATH`， 重启生效。

也可以终端输入命令 `export PATH=/usr/local/bin:$PATH` ,暂时性的添加环境变量。    



### 安装tiller

Tiller 是 Helm 的服务端，部署在 Kubernetes 集群中。Tiller 用于接收 Helm 的请求，并根据 Chart 生成 Kubernetes 的部署文件（ Helm 称为 Release ），然后提交给 Kubernetes 创建应用。  

由于 kubernetes 从1.6 版本开始加入了 RBAC 授权。当前的 Tiller 没有定义用于授权的 ServiceAccount， 访问 API Server 时会被拒绝，需要给 Tiller 加入授权。

所以我们需要在kubenetes上创建一个serviceaccount并授权给tiller。

```sh
#创建 Kubernetes 的服务帐号和绑定角色
kubectl delete deployment tiller-deploy  --namespace=kube-system
kubectl create serviceaccount --namespace kube-system tiller
kubectl create clusterrolebinding tiller-cluster-rule --clusterrole=cluster-admin --serviceaccount=kube-system:tiller
# 给 Tiller 的 deployments 添加刚才创建的 ServiceAccount
kubectl patch deploy --namespace kube-system tiller-deploy -p '{"spec":{"template":{"spec":{"serviceAccount":"tiller"}}}}'
```

然后使用`helm init --upgrade`初始化helm。

执行`helm version`， 如果没有报错，说明helm已经安装成功。



## 使用helm安装jenkins
`helm install --name jenkins stable/jenkins`

执行完之后提示安装成功,  但使用`kubectl get pods` 发现对应的jenkins pod是`pending`状态。

使用`helm inspect values stable/jenkins`查看配置中的serviceType字段，发现是`ClusterIP`。

这是因为helm默认使用LoadBalancer来将jenkins暴露在公网上，loadBalancer是一个负载均衡器，一般由云服务商提供，需要额外付费，所以这里需要将serviceType的类型改成NodePort。

先删掉原来的release

`helm delete my-release`

重装并指定serviceType

`helm install --name jenkins --set master.serviceType=NodePort stable/jenkins`

查看pods，发现仍然是pending状态。

使用`kubectl describe pod jenkins`查看详细的错误信息

`pod has unbound immediate PersistentVolumeClaims` 

这里的报错信息意思是pod没有绑定到PVC, 先简单介绍一下PVC。

### kubenetes存储简介
容器中运行的应用的数据不是持久化的，一旦容器重启，数据将被清空，而且不同的容器之间也需要共享文件，`Volume`这一概念就是为了解决这两个问题。  kubernetes中的`Volume`的生命周期和pod相同，并且容器重启时数据将被保留。 

`PersistentVolume` 是一种和节点同级的集群资源，有独立于pod的生命周期，这个资源对象将存储的实现细节集中起来，它可以是NFS或者其他的云存储系统。

而`PersistentVolumeClaim`是用户发起的存储使用请求，类似pod消耗cpu和内存资源，而PVC消耗存储资源。

可以使用`kubectl describe pvc`来查看集群中现有的pvc，

可以看到一个名字叫jenkins的PVC，但状态是`pending`,错误的详细信息是

`` no persistent volumes available for this claim and no storage class is set``

这个报错的意思是说现在没有可用的PV（持久化存储卷），解决方法是手动创建一个PV，这里使用hostPath类型，也就是用主机的磁盘作为存储卷，一般生产环境为了安全会使用云服务商提供的存储服务作为PV。

**首先写一个配置文件。**

```
cat > ./pv-volume.yaml <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: jenkins-pv
  labels:
    type: local
spec:
  storageClassName: jenkins-pv
  capacity:
    storage: 1Gi
  accessModes:
    - ReadWriteOnce
  hostPath:
    path: "/mnt/data"
EOF
```
然后执行配置文件

`kubectl apply -f pv-volume.yaml`   

执行`kubectl get pv`  可以看到建好的PV，然后需要生成一个PVC。

```
cat > ./pvc-volume.yaml <<EOF
kind: PersistentVolumeClaim
apiVersion: v1
metadata:
  name: jenkins-pvc
spec:
  storageClassName: "jenkins-pv"
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
EOF
```
`kubectl apply -f pvc-volume.yaml`  

使用`kubectl get pvc`可以看到刚才生成的pvc。

**然后重新安装Jenkins**

先删除原来的Jenkins

`helm delete jenkins`或`helm del --purge jenkins`

推荐使用后者，前者有时候删不干净。

安装jenkins并指定使用已经存在的pvc

`helm install --name jenkins --set persistence.existingClaim=jenkins-pvc --set master.serviceType=NodePort stable/jenkins`  

接下来按照它的提示查看初始的账号密码并初始化jenkins，不执行这一步的话pod会卡在init状态。

`printf $(kubectl get secret --namespace default jenkins -o jsonpath="{.data.jenkins-admin-password}" | base64 --decode);echo    `


使用`kubectl get svc`查看jenkins应用的端口，通过服务器ip加这个端口即可访问jenkins的web界面。






# 5.自动化流程

## 在jenkins上配置GitHub Hook
为了让代码推送完后出发jenkins的自动构建，我们需要在jenkens界面新建一个任务，任务类型选流水线。
构建触发器勾选Github hook trigger for GITScm polling,并输入自己的GitHub账号密码。
在项目根目录新建一个简单的Jenkinsfile

```
pipeline {
    agent { docker 'node' }
    stages {
        stage('build') {
            steps {
                sh 'npm --version'
            }
        }
    }
}
```

在github项目的setting页面找到webhook，添加`[host]/github-webhook/`(注意不要少了最后的/)
然后`mannage Jenkins -> Configure System -> github Server -> add`，在github生成personal token(勾选repo和admin:repo_hook权限) 并填入。这样推送代码后github就会向对应的地址发送请求，通知jenkins开始构建。



## CI/CD

接下来是jenkinsfile的编写，要让构建在kubenetes集群中执行，需要在`agent`字声明kubenetes和构建过程中需要用到的其他环境。(这里省略了其他的stage)

```
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
                - name: node
                  image: node
                  command:
                  - cat
                  tty: true
            """
        }
     }
    stages {
        stage('build') {
          steps {
            container('node') {
              sh 'yarn run build    '
            }
          }
        }
    }
}
```



然后需要将应用打包成image并push到仓库上。这里使用kaniko打包并推送到官方仓库。

先给kaniko授予访问相关docker仓库的权限

```
# 登陆docker，这里登陆官方仓库，也可以登陆其他的云服务商提供的镜像仓库
docker login
# 根据配置文件生成k8s secret
kubectl create secret generic docker-secret --from-file=/root/.docker/config.json

```

`Secret` 对象类型用来保存敏感信息，例如密码、OAuth 令牌和 ssh key。 将这些信息放在 `secret` 中比放在 [Pod](https://kubernetes.io/docs/concepts/workloads/pods/pod-overview/) 的定义或者 [容器镜像](https://kubernetes.io/zh/docs/reference/glossary/?all=true#term-image) 中来说更加安全和灵活。

配置好secret之后，修改jenkinsfile, 配置kaniko运行的环境和鉴权文件。

```
     ...   
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
                - name: node
                  image: node:10.16.3
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
    ...
```

然后添加一个stage

```
        stage('push image') {
          steps {
            container(name: 'kaniko', shell: '/busybox/sh') {
              sh "/kaniko/executor --dockerfile=`pwd`/Dockerfile --context=`pwd` --destination=twisger/ci-demo:latest"
            }
          }
        }
```



`twisger/ci-demo:latest`对应的是你的镜像地址，其他部分一般不需要修改。



**接下来编写应用的chart文件**[参考](https://www.jianshu.com/p/4bd853a8068b)

先用helm初始化一个基本模版并拉到本地

```
# 服务器上执行
helm create frontend-demo
# 本地执行（将模版文件拉到本地）
scp -i ~/.ssh/id_rsa -r  [用户名]@[服务器ip]:[remotepath] [localpath]
```

默认的helm模版是一个nginx应用，只需要修改一下values.yaml文件中的service字段和image字段即可。

```
...
image:
  repository: twisger/ci-demo
  tag: stable
  pullPolicy: IfNotPresent
...
service:
  type: NodePort
  port: 80
...
```


### todo
在jenkins上配置好helm运行的环境















